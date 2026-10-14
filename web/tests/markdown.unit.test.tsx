import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/components/Markdown';

test('existing artifact links become clickable resource buttons without nested markdown', () => {
  const html = renderToStaticMarkup(<Markdown text="Download [cli-check.txt](/workspace/output/cli-check.txt)" onOpenResourcePath={() => {}} />);
  expect(html).toContain('<button');
  expect(html).toContain('cli-check.txt</button>');
  expect(html).not.toContain('resource:%');
});

test('raw output paths link, while code blocks and external URLs remain intact', () => {
  const html = renderToStaticMarkup(<Markdown text={'/workspace/output/image.png\n\n[Docs](https://example.com)\n\n```text\n/workspace/output/private.txt\n```'} />);
  expect(html).toContain('image.png</button>');
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('/workspace/output/private.txt');
});

test("inline code output paths are clickable instead of showing literal Markdown", () => { const html = renderToStaticMarkup(<Markdown text="`/workspace/output/cli-check.txt`" />); expect(html).toContain("cli-check.txt</button>"); expect(html).not.toContain("resource:%"); });

test('bold output paths do not include emphasis markers in the resource URL', () => {
 const html=renderToStaticMarkup(<Markdown text="Saved to **/workspace/output/cat.png**." />);
 expect(html).toContain('cat.png</button>'); expect(html).not.toContain('cat.png**');
});
test('Markdown links inside code remain literal code', () => {
 const html=renderToStaticMarkup(<Markdown text={'```text\n![a](/workspace/output/a.png)\n```'} />);
 expect(html).toContain('![a](/workspace/output/a.png)'); expect(html).not.toContain('resource:');
});

test("malformed resource links cannot crash rendering or open private configuration", () => { const html=renderToStaticMarkup(<Markdown text="[Bad](resource:%E0%A4) [Private](resource:%2F.env)" />); expect(html).toContain("Bad</span>"); expect(html).toContain("Private</span>"); expect(html).not.toContain("<button"); });
