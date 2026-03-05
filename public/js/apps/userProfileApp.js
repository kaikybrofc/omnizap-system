/* global document */

import { initUserProfileApp } from './userProfile/index.js';

if (document.getElementById('user-app-root')) {
  initUserProfileApp();
}
