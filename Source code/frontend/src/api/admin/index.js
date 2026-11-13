// Single entry point for every Administrator API call. Pages import { adminApi } only from here.
import { config } from '../../config';
import * as real from './real';
import * as mock from './mock';

const impl = config.USE_MOCK_ADMIN ? mock : real;
export const isMockAdmin = config.USE_MOCK_ADMIN;

export const adminApi = {
  ...impl,
  // Contract v1.1: Platform PATCH disables a user AND requests real-time revoke.
  // No second /admin/users/:id/deny call is necessary.
  async blockUser(user) {
    const result = await impl.updateUser(user.id, { disabled: true });
    if (result?.realtimeSync === false) {
      throw new Error('Account disabled, but real-time revoke failed. Retry Block to sync active sessions.');
    }
  },
  async unblockUser(user) {
    await impl.updateUser(user.id, { disabled: false });
    // Legacy deny (if an administrator separately used it) remains managed on Connections page.
  }
};
