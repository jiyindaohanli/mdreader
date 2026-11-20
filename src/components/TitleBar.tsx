import { currentWindow } from "mygo-runtime";

const GLYPH = {
  close: (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1.6 1.6 6.4 6.4M6.4 1.6 1.6 6.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  min: (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1.5 4h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  max: (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1.8 1.8h4.4v4.4H1.8z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
};

interface Props {
  title: string;
  folder: string;
  path: string;
  dirty: boolean;
}

export function TitleBar({ title, folder, path, dirty }: Props) {
  return (
    <header className="titlebar">
      <div className="titlebar__dots">
        <button className="dot dot--close" type="button" title="关闭" onClick={() => void currentWindow.close()}>
          {GLYPH.close}
        </button>
        <button className="dot dot--min" type="button" title="最小化" onClick={() => void currentWindow.minimize()}>
          {GLYPH.min}
        </button>
        <button className="dot dot--max" type="button" title="最大化" onClick={() => void currentWindow.toggleMaximize()}>
          {GLYPH.max}
        </button>
      </div>
      <div className="titlebar__title" title={path}>
        {dirty && <span className="titlebar__dirty" aria-label="未保存" />}
        <b>{title}</b>
        {folder && <span className="titlebar__folder">— {folder}</span>}
      </div>
      <div className="titlebar__actions" />
    </header>
  );
}
