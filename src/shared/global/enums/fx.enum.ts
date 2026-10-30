/**
 * Where a rate came from, as seen by the client.
 * - LIVE: fetched from the live provider within the freshness window.
 * - LAST_KNOWN_GOOD: a live snapshot older than the freshness window, served because the provider is failing.
 * - STATIC: the fixed fallback table.
 */
export enum FxSourceEnum {
  LIVE = 'LIVE',
  LAST_KNOWN_GOOD = 'LAST_KNOWN_GOOD',
  STATIC = 'STATIC',
}

export enum FxProviderNameEnum {
  openErApi = 'openErApi',
  static = 'static',
}
