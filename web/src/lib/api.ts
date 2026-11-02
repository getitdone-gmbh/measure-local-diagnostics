import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

export interface RuntimeConfig {
  apiUrl: string;
  oidcIssuer: string;
  oidcClientId: string;
}

let config: RuntimeConfig;
let userManager: UserManager | null = null;

export async function loadConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/config.json');
  config = response.ok ? await response.json() : { apiUrl: 'http://localhost:8000', oidcIssuer: '', oidcClientId: '' };
  if (config.oidcIssuer) {
    userManager = new UserManager({
      authority: config.oidcIssuer,
      client_id: config.oidcClientId,
      redirect_uri: `${window.location.origin}/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: 'code',
      scope: 'openid profile',
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    });
  }
  return config;
}

// Returns the signed-in user name, redirects to the login realm when there is no session
export async function ensureSignedIn(): Promise<string | null> {
  if (!userManager) return 'lokal';
  if (window.location.pathname === '/callback') {
    const user = await userManager.signinRedirectCallback();
    const target = typeof user.state === 'string' ? user.state : '/';
    window.history.replaceState({}, '', target);
    return user.profile.preferred_username ?? user.profile.sub;
  }
  const user = await userManager.getUser();
  if (user && !user.expired) return user.profile.preferred_username ?? user.profile.sub;
  await userManager.signinRedirect({ state: window.location.pathname + window.location.search });
  return null;
}

export async function signOut(): Promise<void> {
  await userManager?.signoutRedirect();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const user = await userManager?.getUser();
  if (user?.access_token) headers.set('Authorization', `Bearer ${user.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
  if (response.status === 401 && userManager) {
    await userManager.signinRedirect({ state: window.location.pathname + window.location.search });
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, typeof detail.detail === 'string' ? detail.detail : response.statusText);
  }
  return response.json() as Promise<T>;
}

export function upload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  return api<T>(path, { method: 'POST', body });
}
