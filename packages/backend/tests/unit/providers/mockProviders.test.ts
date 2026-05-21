import { MockSttProvider } from '../../../src/providers/stt/MockSttProvider.js';
import { MockTranslationProvider } from '../../../src/providers/translation/MockTranslationProvider.js';
import { MockTtsProvider } from '../../../src/providers/tts/MockTtsProvider.js';
import {
  runSttCompliance,
  runTranslationCompliance,
  runTtsCompliance,
} from '../../shared/providerComplianceTests.js';

// The mock providers are the reference implementations every other provider is
// validated against; running the shared suite here guards the contract itself.
runSttCompliance('MockSttProvider', () => new MockSttProvider({ script: ['Hello there.'] }));
runTranslationCompliance('MockTranslationProvider', () => new MockTranslationProvider());
runTtsCompliance('MockTtsProvider', () => new MockTtsProvider());
