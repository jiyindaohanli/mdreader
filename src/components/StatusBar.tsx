import { useEffect, useRef, useState } from "react";
import type { Doc } from "../mygo";

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
  lines: number;
}

interface Props {
  doc: Doc | null;
  length: number;
  cursor: CursorInfo;
  wrap: boolean;
  overwrite: boolean;
  fontSize: number;
  onWrap(): void;
  onOverwrite(): void;
  onFontSize(size: number): void;
  onFormat(eol: string, encoding: string): void;
}

const EOL_CHOICES: [string, string][] = [
  ["\r\n", "Windows (CRLF)"],
  ["\n", "Unix (LF)"],
  ["\r", "Macintosh (CR)"],
];

const ENCODING_CHOICES: [string, string][] = [
  ["utf-8", "UTF-8"],
  ["utf-8-bom", "UTF-8 BOM"],
  ["gbk", "GBK"],
  ["utf-16le", "UTF-16 LE"],
  ["utf-16be", "UTF-16 BE"],
];

const SIZE_CHOICES = [12, 13, 13.5, 15, 16, 18, 20];

const eolLabel = (eol: string) => EOL_CHOICES.find(([value]) => value === eol)?.[1] ?? eol;
const encodingLabel = (encoding: string) => ENCODING_CHOICES.find(([value]) => value === encoding)?.[1] ?? encoding;

/** The Notepad++-style bar along the bottom: position, size, format, modes. */
export function StatusBar({ doc, length, cursor, wrap, overwrite, fontSize, onWrap, onOverwrite, onFontSize, onFormat }: Props) {
  const [menu, setMenu] = useState<null | "eol" | "encoding" | "size">(null);
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (bar.current && !bar.current.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  if (!doc) return null;

  return (
    <footer className="statusbar" ref={bar}>
      <div className="statusbar__items">
        <span title="光标位置">行 {cursor.line}，列 {cursor.column}</span>
        {cursor.selected > 0 && <span title="选中的字符数">选中 {cursor.selected}</span>}
        <span title="文档字符数">长度 {length}</span>
        <span title="总行数">行数 {cursor.lines}</span>
      </div>
      <div className="statusbar__items statusbar__items--end">
        <div className="statusbar__anchor">
          <button
            type="button"
            className="statusbar__button"
            title="换行符：点击切换"
            aria-haspopup="menu"
            onClick={() => setMenu(menu === "eol" ? null : "eol")}
          >
            {eolLabel(doc.eol)}
          </button>
          {menu === "eol" && (
            <div className="statusbar__menu" role="menu">
              {EOL_CHOICES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={doc.eol === value}
                  className="statusbar__choice"
                  onClick={() => {
                    setMenu(null);
                    if (doc.eol !== value) onFormat(value, doc.encoding);
                  }}
                >
                  <span>{label}</span>
                  {doc.eol === value && <span className="statusbar__check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="statusbar__anchor">
          <button
            type="button"
            className="statusbar__button"
            title="编码：点击转换"
            aria-haspopup="menu"
            onClick={() => setMenu(menu === "encoding" ? null : "encoding")}
          >
            {encodingLabel(doc.encoding)}
          </button>
          {menu === "encoding" && (
            <div className="statusbar__menu" role="menu">
              {ENCODING_CHOICES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={doc.encoding === value}
                  className="statusbar__choice"
                  onClick={() => {
                    setMenu(null);
                    if (doc.encoding !== value) onFormat(doc.eol, value);
                  }}
                >
                  <span>{label}</span>
                  {doc.encoding === value && <span className="statusbar__check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="statusbar__anchor">
          <button
            type="button"
            className="statusbar__button"
            title="编辑器字号"
            aria-haspopup="menu"
            onClick={() => setMenu(menu === "size" ? null : "size")}
          >
            字号 {fontSize}
          </button>
          {menu === "size" && (
            <div className="statusbar__menu" role="menu">
              {SIZE_CHOICES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="menuitemradio"
                  aria-checked={fontSize === size}
                  className="statusbar__choice"
                  onClick={() => {
                    setMenu(null);
                    if (fontSize !== size) onFontSize(size);
                  }}
                >
                  <span>{size} px</span>
                  {fontSize === size && <span className="statusbar__check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="statusbar__button"
          title="插入 / 覆盖模式（Insert）"
          onClick={onOverwrite}
        >
          {overwrite ? "OVR" : "INS"}
        </button>
        <button
          type="button"
          className="statusbar__button"
          data-on={wrap}
          title="自动换行"
          aria-pressed={wrap}
          onClick={onWrap}
        >
          自动换行
        </button>
      </div>
    </footer>
  );
}
