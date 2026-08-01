
import React, { useState } from 'react';
import { ClipboardIcon, CheckIcon } from './icons';

interface CodeBlockProps {
  content: string;
  language?: string;
  variant?: 'standard' | 'output';
}

/**
 * Lightweight, zero-dependency XML tokenizer for syntax highlighting.
 * Distinguishes comments, declarations, tag punctuation, tag names,
 * attribute names, and attribute values. Intentionally hand-rolled
 * (regex-based) rather than pulling in a highlighter library, consistent
 * with the toolkit's local-only, no-backend, zero-dependency philosophy.
 */
const highlightTag = (tag: string, keyBase: string): React.ReactNode => {
  const selfClosing = tag.endsWith('/>');
  const isClosing = tag.startsWith('</');
  const innerStart = isClosing ? 2 : 1;
  const innerEnd = selfClosing ? tag.length - 2 : tag.length - 1;
  const content = tag.slice(innerStart, innerEnd);

  const nameMatch = content.match(/^[\w:.-]+/);
  const tagName = nameMatch ? nameMatch[0] : '';
  const rest = content.slice(tagName.length);

  const attrRegex = /([\w:.-]+)(=)("[^"]*"|'[^']*')/g;
  const attrNodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let ak = 0;
  while ((m = attrRegex.exec(rest)) !== null) {
    if (m.index > lastIndex) {
      attrNodes.push(rest.slice(lastIndex, m.index));
    }
    attrNodes.push(
      <React.Fragment key={`${keyBase}-a${ak++}`}>
        <span className="text-amber-300">{m[1]}</span>
        <span className="text-slate-400">{m[2]}</span>
        <span className="text-emerald-400">{m[3]}</span>
      </React.Fragment>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < rest.length) {
    attrNodes.push(rest.slice(lastIndex));
  }

  return (
    <span key={keyBase} className="text-slate-500">
      {'<'}
      {isClosing ? '/' : ''}
      <span className="text-cyan-400">{tagName}</span>
      {attrNodes}
      {selfClosing ? ' /' : ''}
      {'>'}
    </span>
  );
};

const highlightXml = (xml: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const outerRegex = /(<!--[\s\S]*?-->)|(<\?[\s\S]*?\?>)|(<[^>]*>)|([^<]+)/g;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = outerRegex.exec(xml)) !== null) {
    const [, comment, decl, tag, text] = match;
    if (comment) {
      parts.push(<span key={key++} className="text-slate-500 italic">{comment}</span>);
    } else if (decl) {
      parts.push(<span key={key++} className="text-purple-400">{decl}</span>);
    } else if (tag) {
      parts.push(highlightTag(tag, String(key++)));
    } else if (text) {
      parts.push(<span key={key++} className="text-slate-100">{text}</span>);
    }
  }

  return parts;
};

const CodeBlock: React.FC<CodeBlockProps> = ({ content, language = 'text', variant = 'standard' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isOutput = variant === 'output';
  const isXml = language === 'xml';

  return (
    <div className={`bg-slate-800 rounded-lg relative my-2 ${isOutput ? 'border border-slate-700 shadow-inner' : ''}`}>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-800 z-10"
        title="Copy to clipboard"
      >
        {copied ? (
          <CheckIcon className="h-5 w-5 text-green-400" />
        ) : (
          <ClipboardIcon className="h-5 w-5" />
        )}
      </button>
      <pre className={`p-4 text-sm font-mono leading-relaxed custom-scrollbar whitespace-pre-wrap break-all ${
          isOutput ? 'text-sky-400' : 'text-slate-100'
      }`}>
        <code className={`language-${language}`}>
          {isXml ? highlightXml(content) : content}
        </code>
      </pre>
    </div>
  );
};

export default CodeBlock;
