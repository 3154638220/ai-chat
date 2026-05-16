import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseModelRoute } from '../dist/modelRouting.js';

const config = {
  deepseek: {
    fastModel: 'deepseek-v4-flash',
    proModel: 'deepseek-v4-pro',
  },
};

test('uses fast model for ordinary auto messages', () => {
  const route = chooseModelRoute('今天吃了很好吃的面', 'auto', config);
  assert.equal(route.model, 'deepseek-v4-flash');
  assert.equal(route.mode, 'fast');
});

test('uses pro model for forced or complex messages', () => {
  assert.equal(chooseModelRoute('随便聊聊', 'auto', config, true).model, 'deepseek-v4-pro');
  assert.equal(chooseModelRoute('我最近压力很大，不知道怎么办', 'auto', config).model, 'deepseek-v4-pro');
});

test('respects explicit mode', () => {
  assert.equal(chooseModelRoute('压力', 'fast', config).model, 'deepseek-v4-flash');
  assert.equal(chooseModelRoute('日常', 'pro', config).model, 'deepseek-v4-pro');
});
