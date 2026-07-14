import express from 'express';
// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { userDb, apiKeysDb, projectsDb } from '../modules/database/index.js';
import { queryClaudeSDK } from '../claude-sdk.js';
import { providerModelsService } from '../modules/providers/services/provider-models.service.js';
import { IS_PLATFORM } from '../constants/config.js';
import { normalizeProjectPath } from '../shared/utils.js';

const router = express.Router();

/**
 * Middleware to authenticate agent API requests.
 *
 * Supports two authentication modes:
 * 1. Platform mode (IS_PLATFORM=true): For managed/hosted deployments where
 *    authentication is handled by an external proxy. Requests are trusted and
 *    the default user context is used.
 *
 * 2. API key mode (default): For self-hosted deployments where users authenticate
 *    via API keys created in the UI. Keys are validated against the local database.
 */
const validateExternalApiKey = (req, res, next) => {
  // Platform mode: Authentication is handled externally (e.g., by a proxy layer).
  // Trust the request and use the default user context.
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
    return;
  }

  // Self-hosted mode: Validate API key from header or query parameter
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const user = apiKeysDb.validateApiKey(apiKey);

  if (!user) {
    return res.status(401).json({ error: 'Invalid or inactive API key' });
  }

  req.user = user;
  next();
};

/**
 * Clean up a temporary project directory and its Claude session
 * @param {string} projectPath - Path to the project directory
 * @param {string} sessionId - Session ID to clean up
 */
async function cleanupProject(projectPath, sessionId = null) {
  try {
    // Only clean up projects in the external-projects directory
    if (!projectPath.includes('.claude/external-projects')) {
      console.warn('⚠️ Refusing to clean up non-external project:', projectPath);
      return;
    }

    console.log('🧹 Cleaning up project:', projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
    console.log('✅ Project cleaned up');

    // Also clean up the Claude session directory if sessionId provided
    if (sessionId) {
      try {
        const sessionPath = path.join(os.homedir(), '.claude', 'sessions', sessionId);
        console.log('🧹 Cleaning up session directory:', sessionPath);
        await fs.rm(sessionPath, { recursive: true, force: true });
        console.log('✅ Session directory cleaned up');
      } catch (error) {
        console.error('⚠️ Failed to clean up session directory:', error.message);
      }
    }
  } catch (error) {
    console.error('❌ Failed to clean up project:', error);
  }
}

/**
 * SSE Stream Writer - Adapts SDK/CLI output to Server-Sent Events
 */
class SSEStreamWriter {
  constructor(res, userId = null) {
    this.res = res;
    this.sessionId = null;
    this.userId = userId;
    this.isSSEStreamWriter = true;  // Marker for transport detection
  }

  send(data) {
    if (this.res.writableEnded) {
      return;
    }

    // Format as SSE - providers send raw objects, we stringify
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  end() {
    if (!this.res.writableEnded) {
      this.res.write('data: {"type":"done"}\n\n');
      this.res.end();
    }
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
    this.send({ type: 'session-id', sessionId });
  }

  getSessionId() {
    return this.sessionId;
  }
}

/**
 * Non-streaming response collector
 */
class ResponseCollector {
  constructor(userId = null) {
    this.messages = [];
    this.sessionId = null;
    this.userId = userId;
  }

  send(data) {
    // Store ALL messages for now - we'll filter when returning
    this.messages.push(data);

    // Extract sessionId if present
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed.sessionId) {
          this.sessionId = parsed.sessionId;
        }
      } catch (e) {
        // Not JSON, ignore
      }
    } else if (data && data.sessionId) {
      this.sessionId = data.sessionId;
    }
  }

  end() {
    // Do nothing - we'll collect all messages
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }

  getMessages() {
    return this.messages;
  }

  /**
   * Get filtered assistant messages only
   */
  getAssistantMessages() {
    const assistantMessages = [];

    for (const msg of this.messages) {
      // Skip initial status message
      if (msg && msg.type === 'status') {
        continue;
      }

      // Handle JSON strings
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          // Only include claude-response messages with assistant type
          if (parsed.type === 'claude-response' && parsed.data && parsed.data.type === 'assistant') {
            assistantMessages.push(parsed.data);
          }
        } catch (e) {
          // Not JSON, skip
        }
      }
    }

    return assistantMessages;
  }

  /**
   * Calculate total tokens from all messages
   */
  getTotalTokens() {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;

    for (const msg of this.messages) {
      let data = msg;

      // Parse if string
      if (typeof msg === 'string') {
        try {
          data = JSON.parse(msg);
        } catch (e) {
          continue;
        }
      }

      // Extract usage from claude-response messages
      if (data && data.type === 'claude-response' && data.data) {
        const msgData = data.data;
        if (msgData.message && msgData.message.usage) {
          const usage = msgData.message.usage;
          totalInput += usage.input_tokens || 0;
          totalOutput += usage.output_tokens || 0;
          totalCacheRead += usage.cache_read_input_tokens || 0;
          totalCacheCreation += usage.cache_creation_input_tokens || 0;
        }
      }
    }

    const inputTokens = totalInput + totalCacheRead + totalCacheCreation;

    return {
      inputTokens,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      totalTokens: inputTokens + totalOutput
    };
  }
}

// ===============================
// External API Endpoint
// ===============================

/**
 * POST /api/agent
 *
 * Trigger an AI agent to work on an existing project directory.
 */
router.post('/', validateExternalApiKey, async (req, res) => {
  const { projectPath, message, provider = 'claude', model, sessionId } = req.body;
  const effort = typeof req.body.effort === 'string' && req.body.effort.trim()
    ? req.body.effort.trim()
    : undefined;

  // Parse stream and cleanup as booleans (handle string "true"/"false" from curl)
  const stream = req.body.stream === undefined ? true : (req.body.stream === true || req.body.stream === 'true');
  const cleanup = req.body.cleanup === undefined ? true : (req.body.cleanup === true || req.body.cleanup === 'true');

  // Validate inputs
  if (!projectPath) {
    return res.status(400).json({ error: 'projectPath is required' });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!['claude', 'cursor', 'opencode'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "claude", "cursor", or "opencode"' });
  }

  let finalProjectPath = null;
  let writer = null;

  try {
    // Use existing project path
    finalProjectPath = normalizeProjectPath(path.resolve(projectPath));

    // Verify the path exists
    try {
      await fs.access(finalProjectPath);
    } catch (error) {
      throw new Error(`Project path does not exist: ${finalProjectPath}`);
    }

    finalProjectPath = normalizeProjectPath(finalProjectPath);

    // Register project path in DB (or reuse existing active registration)
    const registrationResult = projectsDb.createProjectPath(finalProjectPath, null);
    if (registrationResult.outcome === 'active_conflict') {
      console.log('Project registration already exists for:', finalProjectPath);
    } else {
      console.log('Project registered:', registrationResult.project);
    }

    // Set up writer based on streaming mode
    if (stream) {
      // Set up SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      writer = new SSEStreamWriter(res, req.user.id);

      // Send initial status
      writer.send({
        type: 'status',
        message: 'Session started',
        projectPath: finalProjectPath
      });
    } else {
      // Non-streaming mode: collect messages
      writer = new ResponseCollector(req.user.id);

      // Collect initial status message
      writer.send({
        type: 'status',
        message: 'Session started',
        projectPath: finalProjectPath
      });
    }

    const opencodeModels = (await providerModelsService.getProviderModels('opencode')).models;

    // Start the appropriate session
    if (provider === 'claude') {
      console.log('🤖 Starting Claude SDK session');

      await queryClaudeSDK(message.trim(), {
        projectPath: finalProjectPath,
        cwd: finalProjectPath,
        sessionId: sessionId || null,
        model: model,
        effort,
        permissionMode: 'bypassPermissions' // Bypass all permissions for API calls
      }, writer);

    } else if (provider === 'opencode') {
      return res.status(501).json({
        success: false,
        error: 'OpenCode provider is not available in this build.',
      });
    }

    // Handle response based on streaming mode
    if (stream) {
      // Streaming mode: end the SSE stream
      writer.end();
    } else {
      // Non-streaming mode: send filtered messages and token summary as JSON
      const assistantMessages = writer.getAssistantMessages();
      const tokenSummary = writer.getTotalTokens();

      const response = {
        success: true,
        sessionId: writer.getSessionId(),
        messages: assistantMessages,
        tokens: tokenSummary,
        projectPath: finalProjectPath
      };

      res.json(response);
    }

  } catch (error) {
    console.error('❌ External session error:', error);

    if (stream) {
      // For streaming, send error event and stop
      if (!writer) {
        // Set up SSE headers if not already done
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        writer = new SSEStreamWriter(res, req.user.id);
      }

      if (!res.writableEnded) {
        writer.send({
          type: 'error',
          error: error.message,
          message: `Failed: ${error.message}`
        });
        writer.end();
      }
    } else if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

export default router;