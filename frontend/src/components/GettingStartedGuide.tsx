import { Link } from "react-router-dom";

export const GETTING_STARTED_TITLE = "从这里开始";

export const GETTING_STARTED_INTRO =
  "Askme 按你为每个板块指定的整理规则，把订阅源整理成可读简报。添加数据源前须先配置密钥。";

interface GettingStartedGuideProps {
  /** 引导内跳转链接点击时回调（例如关闭帮助弹层） */
  onNavigate?: () => void;
  onExplainRule?: () => void;
}

export default function GettingStartedGuide({
  onNavigate,
  onExplainRule,
}: GettingStartedGuideProps) {
  return (
    <ol className="guide-steps">
      <li>
        <strong>配置 API Key</strong>
        <span>
          去{" "}
          <Link to="/settings?tab=model" className="guide-step-link" onClick={onNavigate}>
            API Key
          </Link>{" "}
          添加 LLM API Key（简报与提问）和 Cursor API Key（接入源）
        </span>
      </li>
      <li>
        <strong>添加数据源</strong>
        <span>
          在「
          <Link to="/sources" className="guide-step-link" onClick={onNavigate}>
            源
          </Link>
          」页接入网站或平台账号
        </span>
      </li>
      <li>
        <strong>更新源信息</strong>
        <span>刷新文章列表；进度在顶部可见</span>
      </li>
      <li>
        <strong>为板块设置整理规则</strong>
        <span>
          决定如何分类与取舍；每组须手动指定，无默认
          {onExplainRule ? (
            <button type="button" onClick={onExplainRule} className="guide-step-hint">
              规则是什么？
            </button>
          ) : null}
        </span>
      </li>
      <li>
        <strong>生成简报</strong>
        <span>回到简报页，按规则浏览要点</span>
      </li>
      <li>
        <strong>设置定时</strong>
        <span>
          在{" "}
          <Link to="/settings?tab=sync" className="guide-step-link" onClick={onNavigate}>
            定时
          </Link>{" "}
          里为分组安排自动更新
        </span>
      </li>
    </ol>
  );
}
