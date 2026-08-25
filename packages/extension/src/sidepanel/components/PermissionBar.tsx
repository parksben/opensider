import { ShieldAlert } from "lucide-react";
import type { PermissionRequest, PlanPrompt, QuestionPrompt } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { Markdown } from "./Markdown";
import { RippleButton } from "./RippleButton";

export function PermissionBar({
  locale,
  permission,
  question,
  plan,
  onPermission,
  onQuestion,
  onPlan,
}: {
  locale: Locale;
  permission?: PermissionRequest;
  question?: QuestionPrompt;
  plan?: PlanPrompt;
  onPermission: (optionId: string) => void;
  onQuestion: (answers: Array<{ questionId: string; selectedOptionIds: string[] }>) => void;
  onPlan: (accepted: boolean) => void;
}) {
  if (permission) {
    return (
      <section className="border-t border-[var(--line)] bg-[#1a160e] px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2 text-[12.5px]">
          <ShieldAlert size={14} className="text-[var(--brass)]" />
          <span>{permission.title || t(locale, "wantsTool")}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {permission.options.map((option) => (
            <RippleButton
              key={option.optionId}
              onClick={() => onPermission(option.optionId)}
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[12px] hover:border-[var(--brass)]"
            >
              {option.name}
            </RippleButton>
          ))}
        </div>
      </section>
    );
  }

  if (question) {
    return <QuestionForm locale={locale} prompt={question} onSubmit={onQuestion} />;
  }

  if (plan) {
    return (
      <section className="border-t border-[var(--line)] bg-[#1a160e] px-3 py-2.5">
        <div className="mb-1 text-[15px] font-medium tracking-tight">{plan.name || t(locale, "plan")}</div>
        {plan.overview ? <p className="mb-2 text-[12px] text-[var(--muted)]">{plan.overview}</p> : null}
        <Markdown text={plan.plan} />
        <div className="mt-2 flex gap-1.5">
          <RippleButton
            onClick={() => onPlan(true)}
            className="rounded-md bg-[var(--brass)] px-2.5 py-1 text-[12px] text-[#1a140b]"
          >
            {t(locale, "acceptPlan")}
          </RippleButton>
          <RippleButton
            onClick={() => onPlan(false)}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[12px]"
          >
            {t(locale, "reject")}
          </RippleButton>
        </div>
      </section>
    );
  }

  return null;
}

function QuestionForm({
  locale,
  prompt,
  onSubmit,
}: {
  locale: Locale;
  prompt: QuestionPrompt;
  onSubmit: (answers: Array<{ questionId: string; selectedOptionIds: string[] }>) => void;
}) {
  return (
    <form
      className="border-t border-[var(--line)] bg-[#1a160e] px-3 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const answers = prompt.questions.map((question) => ({
          questionId: question.id,
          selectedOptionIds: data.getAll(question.id).map(String),
        }));
        onSubmit(answers);
      }}
    >
      <div className="mb-2 text-[12.5px]">{prompt.title || t(locale, "needsDecision")}</div>
      <div className="space-y-3">
        {prompt.questions.map((question) => (
          <fieldset key={question.id} className="space-y-1">
            <legend className="text-[12px] text-[var(--muted)]">{question.prompt}</legend>
            {question.options.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-[12.5px]">
                <input
                  type={question.allowMultiple ? "checkbox" : "radio"}
                  name={question.id}
                  value={option.id}
                  className="accent-[var(--brass)]"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <RippleButton
        type="submit"
        className="mt-2 rounded-md bg-[var(--brass)] px-2.5 py-1 text-[12px] text-[#1a140b]"
      >
        {t(locale, "continue")}
      </RippleButton>
    </form>
  );
}
