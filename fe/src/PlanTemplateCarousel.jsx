import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/navigation";
import { formatWorkoutDate } from "./workoutHelpers.js";

/** Muted one-liner for disambiguation when {@code label} is null (same as old dummy “tile title”). */
function planSlideSubline(template) {
  if (template?.label) return template.label;
  const rows = Array.isArray(template?.bodyPart) ? template.bodyPart : [];
  const names = [];
  const seen = new Set();
  for (const r of rows) {
    const n = typeof r?.name === "string" ? r.name.trim() : "";
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  if (names.length === 0) return "Plan from history";
  const head = names.slice(0, 2).join(" · ");
  return names.length > 2 ? `${head}…` : head;
}

const slideStyle = {
  width: 220,
  maxWidth: "80vw",
  boxSizing: "border-box",
};

function cueTileInner(label) {
  return (
    <div className="planCarousel__tile planCarousel__tile--startNew" aria-hidden="true">
      <div className="planCarousel__tileDate planCarousel__tileDate--startNew">
        <svg
          className="planCarousel__startNewArrow"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M12 4l7.07 7.07-1.41 1.41L13 8.83V20h-2V8.83L6.34 12.48 4.93 11.07 12 4z"
          />
        </svg>
        <span>{label}</span>
      </div>
      <div className="planCarousel__tileSub planCarousel__tileSub--startNew">Blank session</div>
    </div>
  );
}

/**
 * One slide = one element from {@code GET /workout/recent-plan-templates} (data includes {@code lastUsedDate} and {@code bodyPart}).
 * When {@code showStartNewFirstSlide} (BE: no workout today): slide 0 is “Add new”; slides {@code 1..n} are history plans; last slide is “Start new” on the right. {@code initialSlide} is 0. Lead and trail call {@code onApplyPlan(null)}; plans call {@code onApplyPlan(template)}.
 */
export function PlanTemplateCarousel({
  templates,
  loadError,
  visible,
  onApplyPlan,
  showStartNewFirstSlide = false,
}) {
  const skipFirstSlideChange = useRef(true);
  /** Dedupe {@code onSlideChange} when the active index does not actually change (lead-slide mode). */
  const lastActiveIndexRef = useRef(null);

  const listSignature = useMemo(
    () =>
      `${showStartNewFirstSlide ? "snLR|" : ""}${
        Array.isArray(templates)
          ? templates.map((t) => `${t?.planKey ?? ""}:${t?.sourceWorkoutId ?? ""}`).join("|")
          : ""
      }`,
    [templates, showStartNewFirstSlide]
  );

  useLayoutEffect(() => {
    skipFirstSlideChange.current = true;
  }, [listSignature]);

  if (!visible) return null;
  if (loadError) {
    return (
      <div className="planCarousel planCarousel--error" role="status">
        {loadError}
      </div>
    );
  }
  if (!Array.isArray(templates) || templates.length === 0) return null;

  const totalSlides = templates.length + (showStartNewFirstSlide ? 2 : 0);
  const rewindEnabled = totalSlides > 1;
  const initialSlide = 0;
  const lastSlideIndex = showStartNewFirstSlide ? templates.length + 1 : -1;

  function applyLeadSlideIndex(idx) {
    if (showStartNewFirstSlide) {
      if (idx === 0 || idx === lastSlideIndex) {
        if (typeof onApplyPlan === "function") onApplyPlan(null);
        return;
      }
      const t = templates[idx - 1];
      if (t && typeof onApplyPlan === "function") onApplyPlan(t);
      return;
    }
    const t = templates[idx];
    if (t && typeof onApplyPlan === "function") onApplyPlan(t);
  }

  return (
    <div className="planCarousel" data-plan-template-carousel="" aria-label="Recent workout plans">
      <div className="planCarousel__kicker">Plans from history</div>
      <div className="planCarousel__inner">
        <Swiper
          key={listSignature}
          className="planCarousel__swiper"
          modules={[Navigation]}
          initialSlide={initialSlide}
          navigation
          allowTouchMove
          autoHeight
          centeredSlides
          slidesPerView="auto"
          spaceBetween={12}
          rewind={rewindEnabled}
          onInit={(swiper) => {
            lastActiveIndexRef.current = swiper.activeIndex;
            if (showStartNewFirstSlide && typeof onApplyPlan === "function") {
              onApplyPlan(null);
            }
            swiper.update();
          }}
          onSlideChange={(swiper) => {
            const idx = swiper.activeIndex;

            if (showStartNewFirstSlide) {
              if (lastActiveIndexRef.current === idx) return;
              lastActiveIndexRef.current = idx;
              applyLeadSlideIndex(idx);
              return;
            }

            if (skipFirstSlideChange.current) {
              skipFirstSlideChange.current = false;
              return;
            }
            applyLeadSlideIndex(idx);
          }}
        >
          {showStartNewFirstSlide ? (
            <SwiperSlide key="__add_new_lead__" className="planCarousel__slide" style={slideStyle}>
              {/* Orientation only: not a control — avoids fake-button semantics (PRD). */}
              {cueTileInner("Add new")}
            </SwiperSlide>
          ) : null}
          {templates.map((t) => (
            <SwiperSlide
              key={`${t.planKey}:${t.sourceWorkoutId}`}
              className="planCarousel__slide"
              style={slideStyle}
            >
              <div className="planCarousel__tile" role="group" aria-label={`Plan from ${t.lastUsedDate || "history"}`}>
                <div className="planCarousel__tileDate">{formatWorkoutDate(t.lastUsedDate)}</div>
                <div className="planCarousel__tileSub">{planSlideSubline(t)}</div>
              </div>
            </SwiperSlide>
          ))}
          {showStartNewFirstSlide ? (
            <SwiperSlide key="__start_new_trail__" className="planCarousel__slide" style={slideStyle}>
              {cueTileInner("Start new")}
            </SwiperSlide>
          ) : null}
        </Swiper>
      </div>
    </div>
  );
}
