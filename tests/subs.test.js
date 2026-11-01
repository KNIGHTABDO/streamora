import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubs, toVTT } from '../js/player/subs.js';

const formats = {
  ASS: body => `[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,${body}`,
  SRT: body => `1\n00:00:01,000 --> 00:00:02,000\n${body}`,
  VTT: body => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${body}`,
};
for (const [format, wrap] of Object.entries(formats)) {
  test(`${format} escapes executable and attributed tags while keeping only allowed bare formatting`, () => {
    const input = '<img src=x onerror=alert(1)> <i>i</i><b>b</b><u>u</u><em>e</em><strong>s</strong><br> <i onclick=alert(2)>x</i>';
    const expected = '&lt;img src=x onerror=alert(1)&gt; <i>i</i><b>b</b><u>u</u><em>e</em><strong>s</strong><br> &lt;i onclick=alert(2)&gt;x</i>';
    const [cue] = parseSubs(wrap(input));
    assert.equal(cue.text, expected);
    assert.ok(toVTT([cue]).includes(expected));
    assert.equal(parseSubs(wrap('&lt;img src=x onerror=alert(1)&gt; & <script>x</script>'))[0].text,
      '&amp;lt;img src=x onerror=alert(1)&amp;gt; &amp; &lt;script&gt;x&lt;/script&gt;');
  });
}
test('subtitle sanitizer treats malformed tags as text and allows no formatting attributes', () => {
  const input = '<svg/onload=alert(1)><BR/><b\nonclick=alert(1)> <iframe> &quot;';
  assert.equal(parseSubs(formats.SRT(input))[0].text, '&lt;svg/onload=alert(1)&gt;&lt;BR/&gt;&lt;b\nonclick=alert(1)&gt; &lt;iframe&gt; &amp;quot;');
});
