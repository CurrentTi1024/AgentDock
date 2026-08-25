import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionTitle } from './mentions.ts';

test('buildSessionTitle：首条消息前 20 字符作为默认标题', () => {
  assert.equal(
    buildSessionTitle('帮我分析一下今天的飞行试验数据并给出结论和建议', 'fallback'),
    '帮我分析一下今天的飞行试验数据并给出结论',
  );
  assert.equal(buildSessionTitle('short', 'fallback'), 'short');
});

test('buildSessionTitle：清理 <mention> 标记后再截取', () => {
  const content = '<mention name="CodeReview_Agent-F15B" id="code-review@F15B" /> 审查这段代码';
  assert.equal(buildSessionTitle(content, 'fallback'), '@CodeReview_Agent-F1');
  assert.ok(!buildSessionTitle(content, 'fallback').includes('<mention'));
});

test('buildSessionTitle：多行/连续空白折叠为单空格，空内容回退', () => {
  assert.equal(buildSessionTitle('第一行\n第二行   第三行', 'fallback'), '第一行 第二行 第三行');
  assert.equal(buildSessionTitle('   ', 'fallback'), 'fallback');
  assert.equal(buildSessionTitle('', 'fallback'), 'fallback');
});
