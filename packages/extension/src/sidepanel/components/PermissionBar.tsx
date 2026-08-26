import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { CurrentPage } from "@shared";
import type { PermissionRequest, PlanPrompt, QuestionPrompt } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { Markdown } from "./Markdown";
import { RippleButton } from "./RippleButton";

function HitlBody({ children }: { children: ReactNode }) {
  return (
    <div className="cs-hitl-scroll min-w-0 flex-1 overflow-y-auto break-words text-[12.5px] leading-relaxed">
      {children}
    </div>
  );
}

export function PermissionBar({
  locale,
  permission,
  question,
  plan,
  onPermission,
  onQuestion,
  onPlan,
  page,
}: {
  locale: Locale;
  permission?: PermissionRequest;
  question?: QuestionPrompt;
  plan?: PlanPrompt;
  page?: CurrentPage;
  onPermission: (optionId: string) => void;
  onQuestion: (answers: Array<{ questionId: string; selectedOptionIds: string[] }>) => void;
  onPlan: (accepted: boolean) => void;
}) {
  if (permission) {
    return (
      <section className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5">
        <div className="mb-2 flex items-start gap-2 text-[12.5px]">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--brass)]" />
          <HitlBody>
            <span className="whitespace-pre-wrap">{permission.title || t(locale, "wantsTool")}</span>
          </HitlBody>
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
      <section className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5">
        <div className="mb-1 text-[15px] font-medium tracking-tight">{plan.name || t(locale, "plan")}</div>
        <HitlBody>
          {plan.overview ? <p className="mb-2 text-[12px] text-[var(--muted)]">{plan.overview}</p> : null}
          <Markdown text={plan.plan} page={page} />
        </HitlBody>
        <div className="mt-2 flex gap-1.5">
          <RippleButton
            onClick={() => onPlan(true)}
            className="rounded-md bg-[var(--brass)] px-2.5 py-1 text-[12px] text-[var(--on-brass)]"
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
      className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5"
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
      <HitlBody>
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
      </HitlBody>
      <RippleButton
        type="submit"
        className="mt-2 rounded-md bg-[var(--brass)] px-2.5 py-1 text-[12px] text-[var(--on-brass)]"
      >
        {t(locale, "continue")}
      </RippleButton>
    </form>
  );
}
