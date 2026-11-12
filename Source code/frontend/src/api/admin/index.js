// Single entry point for every Administrator API call. Pages import { adminApi } only from here.
import { config } from '../../config';
import * as real from './real';
import * as mock from './mock';

const impl = config.USE_MOCK_ADMIN ? mock : real;
export const isMockAdmin = config.USE_MOCK_ADMIN;

export const adminApi = {
  ...impl,
  // "Block" = 2 calls from ONE button: Member 3 disables the account, Member 2 disconnects + denies the live sockets now.
  // (If the account call fails nothing is half-done; if the deny call fails the account is still disabled and we say so.)
  async blockUser(user, minutes = 60) {
    await impl.updateUser(user.id, { disabled: true });
    try {
      await impl.denyUser(user.id, minutes);
    } catch (e) {
      e.message = `Account disabled, but the live disconnect failed: ${e.message}`;
      throw e;
    }
  },
  // Reverse: enable the account (Member 3) and lift the reconnect deny (Member 2).
  async unblockUser(user) {
    await impl.updateUser(user.id, { disabled: false });
    try { await impl.allowUser(user.id); } catch (e) { e.message = `Account enabled, but lifting the deny failed: ${e.message}`; throw e; }
  }
};
