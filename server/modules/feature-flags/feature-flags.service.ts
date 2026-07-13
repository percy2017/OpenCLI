import { appConfigDb } from '@/modules/database/index.js';

const RAG_VECTOR_STATE_KEY = 'rag_vector_enabled';

export type RagVectorState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

const DEFAULT_STATE: RagVectorState = {
  enabled: false,
  lastChangedAt: null,
};

function readRagVectorState(): RagVectorState {
  try {
    const raw = appConfigDb.get(RAG_VECTOR_STATE_KEY);
    if (!raw) {
      return { ...DEFAULT_STATE };
    }

    const parsed = JSON.parse(raw) as Partial<RagVectorState>;
    return {
      enabled: parsed.enabled === true,
      lastChangedAt: typeof parsed.lastChangedAt === 'string' ? parsed.lastChangedAt : null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeRagVectorState(next: { enabled: boolean; lastChangedAt: string }): RagVectorState {
  const persisted: RagVectorState = {
    enabled: next.enabled === true,
    lastChangedAt: next.lastChangedAt,
  };

  appConfigDb.set(RAG_VECTOR_STATE_KEY, JSON.stringify(persisted));
  return persisted;
}

export const ragVectorFeatureFlag = {
  getState(): RagVectorState {
    return readRagVectorState();
  },

  isEnabled(): boolean {
    return readRagVectorState().enabled;
  },

  setEnabled(enabled: boolean): RagVectorState {
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean.');
    }

    const next = writeRagVectorState({
      enabled,
      lastChangedAt: new Date().toISOString(),
    });
    return next;
  },

  stateKey: RAG_VECTOR_STATE_KEY,
};
