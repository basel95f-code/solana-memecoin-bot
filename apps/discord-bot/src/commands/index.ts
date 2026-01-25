/**
 * Command registry
 */

import * as check from './check.js';
import * as analyze from './analyze.js';
import * as track from './track.js';
import * as untrack from './untrack.js';
import * as watchlist from './watchlist.js';
import * as stats from './stats.js';
import * as help from './help.js';

export const commands = {
  check,
  analyze,
  track,
  untrack,
  watchlist,
  stats,
  help
};
