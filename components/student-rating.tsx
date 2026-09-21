import { Star } from "lucide-react";

import { setStudentRatingAction } from "@/lib/actions/student-ratings";
import { maxStudentRating } from "@/lib/cohort-ratings";

const stars = Array.from({ length: maxStudentRating }, (_, index) => index + 1);

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {stars.map((value) => (
        <Star
          className={
            value <= rating
              ? "fill-amber-300 text-amber-300"
              : "fill-transparent text-slate-600"
          }
          key={value}
          size={14}
        />
      ))}
    </span>
  );
}

/**
 * Staff rating of one student in one cohort. Read-only until the cohort is
 * finished: a student still working the pods has not earned a rating yet.
 */
export function StudentRating({
  cohortNumber,
  editable,
  fullName,
  rating,
  userId,
}: {
  cohortNumber: number;
  editable: boolean;
  fullName: string;
  rating: number | null;
  userId: string | null;
}) {
  if (!editable || !userId) {
    return rating ? (
      <span
        className="inline-flex"
        title={`Rated ${rating} of ${maxStudentRating}`}
      >
        <Stars rating={rating} />
        <span className="sr-only">
          Rated {rating} of {maxStudentRating}
        </span>
      </span>
    ) : null;
  }

  return (
    <form action={setStudentRatingAction} className="inline-flex items-center">
      <input name="cohortNumber" type="hidden" value={cohortNumber} />
      <input name="userId" type="hidden" value={userId} />
      <span className="flex gap-0.5">
        {stars.map((value) => (
          <button
            className="rounded p-0.5 transition hover:scale-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
            key={value}
            name="rating"
            title={`Rate ${fullName} ${value} of ${maxStudentRating}`}
            type="submit"
            value={value}
          >
            <Star
              aria-hidden="true"
              className={
                rating && value <= rating
                  ? "fill-amber-300 text-amber-300"
                  : "fill-transparent text-slate-600 hover:text-amber-200"
              }
              size={14}
            />
            <span className="sr-only">
              Rate {fullName} {value} of {maxStudentRating}
            </span>
          </button>
        ))}
      </span>
      {rating ? (
        <button
          className="ml-1 text-xs text-slate-500 transition hover:text-slate-300"
          name="rating"
          type="submit"
          value={0}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
