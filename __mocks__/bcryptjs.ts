import { MOCK_HASH } from '../src/test_utils/mock-utils';

interface MockBcrypt {
  hash: () => string;

  compare: () => boolean;
}

const bcryptjs = jest.createMockFromModule<MockBcrypt>('bcryptjs');

bcryptjs.hash = () => {
  return MOCK_HASH;
};

bcryptjs.compare = () => {
  return true;
};

export default bcryptjs;
