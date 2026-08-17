import { FakeProvider } from './fake-provider.js';
import { registerProviderContract } from './contract-tests.js';

registerProviderContract('FakeProvider', async () => ({
  provider: new FakeProvider(),
  workspaceId: 'ws-contract',
}));
