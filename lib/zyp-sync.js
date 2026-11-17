/**
 * 同源多子项目共用的云同步客户端（零依赖，需登录）
 * 用法见 worker/README.md
 */
var ZypSync = (function () {
  'use strict';

  var TOKEN_KEY = 'zyp-session-token-v1';
  var USER_KEY = 'zyp-session-user-v1';
  var API_KEY = 'zyp-sync-api-v1';

  function apiBase() {
    try {
      var g = typeof DEFAULT_SYNC_API !== 'undefined' ? DEFAULT_SYNC_API : '';
      var u = localStorage.getItem(API_KEY) || g || '';
      return String(u).replace(/\/+$/, '');
    } catch (e) {
      return typeof DEFAULT_SYNC_API !== 'undefined' ? DEFAULT_SYNC_API : '';
    }
  }

  function enabled() {
    return !!apiBase();
  }

  function setApi(url) {
    try {
      localStorage.setItem(API_KEY, String(url || '').replace(/\/+$/, ''));
    } catch (e) {}
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setSession(token, username) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (username) localStorage.setItem(USER_KEY, username);
    } catch (e) {}
  }

  function getUsername() {
    try {
      return localStorage.getItem(USER_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function isLoggedIn() {
    return enabled() && !!getToken();
  }

  function logout() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  function sameSiteApi() {
    try {
      return new URL(apiBase(), location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function req(path, opts) {
    var base = apiBase();
    if (!base) return Promise.reject(new Error('未配置同步 API'));
    opts = opts || {};
    opts.cache = 'no-store';
    if (sameSiteApi()) opts.credentials = 'include';
    return fetch(base + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        return j;
      });
    });
  }

  function requireToken() {
    var t = getToken();
    if (!t) return Promise.reject(new Error('未登录'));
    return Promise.resolve(t);
  }

  function register(username, password) {
    return req('/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    }).then(function (res) {
      setSession(res.token, res.username || username);
      return res;
    });
  }

  function login(username, password) {
    return req('/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    }).then(function (res) {
      setSession(res.token, res.username || username);
      return res;
    });
  }

  function pull(projectId) {
    return requireToken().then(function (token) {
      var q = '/v1/projects/' + encodeURIComponent(projectId) + '?_=' + Date.now();
      return req(q, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
    });
  }

  function push(projectId, data) {
    var frozen = JSON.parse(JSON.stringify(data));
    return requireToken().then(function (token) {
      return req('/v1/projects/' + encodeURIComponent(projectId), {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: frozen }),
      });
    });
  }

  function pullAfterLogin(projectId) {
    return pull(projectId).catch(function (e) {
      if (String(e.message || '').indexOf('invalid token') >= 0) {
        logout();
      }
      throw e;
    });
  }

  return {
    enabled: enabled,
    apiBase: apiBase,
    setApi: setApi,
    isLoggedIn: isLoggedIn,
    getUsername: getUsername,
    logout: logout,
    health: function () { return req('/health'); },
    register: register,
    login: login,
    pull: pullAfterLogin,
    push: push,
  };
})();