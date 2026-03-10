import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";

// Session-only: no localStorage persistence
export const manager = new AccountManager();
registerCommonAccountTypes(manager);
