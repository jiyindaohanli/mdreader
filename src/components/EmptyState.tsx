interface Props {
  loading: boolean;
}

export function EmptyState({ loading }: Props) {
  if (loading) {
    return (
      <div className="empty">
        <span className="empty__spinner" aria-label="正在打开" />
      </div>
    );
  }
  return (
    <div className="empty">
      <svg className="empty__art" width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <rect x="30" y="18" width="72" height="96" rx="12" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
        <path d="M50 46h32M50 60h32M50 74h20" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="96" cy="98" r="18" fill="var(--accent)" />
        <path d="M88 104V92l4 8 4-8v12" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <h2>还没有打开文档</h2>
      <p>
        按 <kbd>Ctrl</kbd> + <kbd>O</kbd> 选择文件，或把 <code>.md</code> 拖进这个窗口
      </p>
      <p className="empty__hint">
        <kbd>Ctrl</kbd> + <kbd>P</kbd> 快速打开 · <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> 命令
      </p>
    </div>
  );
}
