import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LabCredentialReveal } from "@/components/lab-credential-reveal";
import type { StudentCredentialResult } from "@/lib/actions/lab-credentials";

async function reveal(): Promise<StudentCredentialResult> {
  return {
    ok: true,
    labUsername: "student02",
    password: "Canyon-kM4tqW-73",
    podName: "Pod02",
  };
}

describe("LabCredentialReveal", () => {
  it("keeps the password out of the rendered page until the student asks", () => {
    const markup = renderToStaticMarkup(
      <LabCredentialReveal labUsername="student02" reveal={reveal} />,
    );

    expect(markup).not.toContain("Canyon-kM4tqW-73");
    expect(markup).toContain("student02");
    expect(markup).toContain("Show my lab password");
  });
});
