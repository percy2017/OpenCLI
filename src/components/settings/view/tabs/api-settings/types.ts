export type ApiKeyItem = {
  id: string;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used?: string | null;
  is_active: boolean;
};

export type CreatedApiKey = {
  id: string;
  keyName: string;
  apiKey: string;
  createdAt?: string;
};

export type ApiKeysResponse = {
  apiKeys?: ApiKeyItem[];
  success?: boolean;
  error?: string;
  apiKey?: CreatedApiKey;
};