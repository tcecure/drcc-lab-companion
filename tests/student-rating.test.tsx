import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentRating } from "@/components/student-rating";

describe("StudentRating", () => {
  it("renders the filled stars read-only while the cohort is active", () => {
    const markup = renderToStaticMarkup(
      <StudentRating
        cohortNumber={3}
        editable={false}
        fullName="Emma Manjo"
        rating={4}
        userId="11111111-1111-4111-8111-111111111111"
      />,
    );

    expect(markup).not.toContain("<form");
    expect(markup).toContain("Rated 4 of 5");
  });

  it("renders nothing for an unrated student who cannot be rated yet", () => {
    const markup = renderToStaticMarkup(
      <StudentRating
        cohortNumber={3}
        editable={false}
        fullName="Emma Manjo"
        rating={null}
        userId="11111111-1111-4111-8111-111111111111"
      />,
    );

    expect(markup).toBe("");
  });

  it("submits the cohort, student and star value once the cohort is finished", () => {
    const markup = renderToStaticMarkup(
      <StudentRating
        cohortNumber={1}
        editable
        fullName="Chike Nzegwu"
        rating={3}
        userId="22222222-2222-4222-8222-222222222222"
      />,
    );

    expect(markup).toContain('name="cohortNumber" value="1"');
    expect(markup).toContain("22222222-2222-4222-8222-222222222222");
    expect(markup).toContain('title="Rate Chike Nzegwu 5 of 5"');
    expect(markup).toContain('value="5" name="rating"');
    expect(markup).toContain("Clear");
  });

  it("stays read-only when the standings row has no portal account", () => {
    const markup = renderToStaticMarkup(
      <StudentRating
        cohortNumber={1}
        editable
        fullName="Student 09"
        rating={2}
        userId={null}
      />,
    );

    expect(markup).not.toContain("<form");
  });
});
