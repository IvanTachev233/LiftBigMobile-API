/** What the app checks at start and on resume */
export interface AppConfig {
  /** Builds below this Android versionCode must update; null means none */
  minVersionCode: number | null;
  /** Builds below this one are offered an update; null means none */
  latestVersionCode: number | null;
}

/**
 * The version codes from APP_MIN_VERSION_CODE and APP_LATEST_VERSION_CODE,
 * null when unset. Anything but a positive whole number throws, naming the
 * variable.
 */
export function appConfigFromEnv(env: NodeJS.ProcessEnv): AppConfig {
  return {
    minVersionCode: versionCode(
      env.APP_MIN_VERSION_CODE,
      'APP_MIN_VERSION_CODE',
    ),
    latestVersionCode: versionCode(
      env.APP_LATEST_VERSION_CODE,
      'APP_LATEST_VERSION_CODE',
    ),
  };
}

function versionCode(value: string | undefined, name: string): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new Error(
      `${name} must be an Android versionCode (a whole number from 1), not "${value}"`,
    );
  }
  return Number(text);
}
