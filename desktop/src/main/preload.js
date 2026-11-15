'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('srot', {
  init: call('app:init'),
  add: call('dl:add'),
  probe: call('dl:probe'),
  pause: call('dl:pause'),
  resume: call('dl:resume'),
  startNow: call('dl:startNow'),
  remove: call('dl:remove'),
  move: call('dl:move'),
  pauseAll: call('dl:pauseAll'),
  resumeAll: call('dl:resumeAll'),
  clearFinished: call('dl:clearFinished'),
  updateUrl: call('dl:updateUrl'),
  schedule: call('dl:schedule'),
  detail: call('dl:detail'),
  openFile: call('file:open'),
  reveal: call('file:reveal'),
  pickFolder: call('dialog:folder'),
  setSettings: call('settings:set'),
  videoProbe: call('video:probe'),
  videoAdd: call('video:add'),
  toolsStatus: call('tools:status'),
  toolsInstall: call('tools:install'),
  toolsUpdate: call('tools:update'),
  exportExtension: call('ext:export'),
  copyText: call('clipboard:write'),
  clipboardUrl: call('clipboard:url'),
  onUpdate: on('update'),
  onSettings: on('settings'),
  onToolProgress: on('tools:progress'),
  onOpenAdd: on('ui:add'),
  onOpenVideo: on('ui:video'),
  onOpenSettings: on('ui:settings'),
  onToast: on('toast'),
});
