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
