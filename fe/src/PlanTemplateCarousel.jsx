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

/**
 * One slide = one element from {@code GET /workout/recent-plan-templates} (data includes {@code lastUsedDate} and {@code bodyPart}).
 * Layout matches the old {@code HomePickCarousel} dummy: fixed-width cards, touch swipe, and arrow nav with {@code rewind}.
 * {@code onApplyPlan} runs on real slide change (not the first init event) to map {@code bodyPart} locally.
 */
export function PlanTemplateCarousel({ templates, loadError, visible, onApplyPlan }) {
  const skipFirstSlideChange = useRef(true);
  const listSignature = useMemo(
    () =>
      Array.isArray(templates)
        ? templates.map((t) => `${t?.planKey ?? ""}:${t?.sourceWorkoutId ?? ""}`).join("|")
        : "",
    [templates]
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

  return (
    <div className="planCarousel" data-plan-template-carousel="" aria-label="Recent workout plans">
      <div className="planCarousel__kicker">Plans from history</div>
      <div className="planCarousel__inner">
        <Swiper
          key={listSignature}
          className="planCarousel__swiper"
          modules={[Navigation]}
          navigation
          allowTouchMove
          autoHeight
          centeredSlides
          slidesPerView="auto"
          spaceBetween={12}
          rewind
          onInit={(swiper) => {
            swiper.update();
          }}
          onSlideChange={(swiper) => {
            if (skipFirstSlideChange.current) {
              skipFirstSlideChange.current = false;
              return;
            }
            const t = templates[swiper.activeIndex];
            if (t && typeof onApplyPlan === "function") onApplyPlan(t);
          }}
        >
          {templates.map((t) => (
            <SwiperSlide
              key={`${t.planKey}:${t.sourceWorkoutId}`}
              className="planCarousel__slide"
              style={{
                width: 220,
                maxWidth: "80vw",
                boxSizing: "border-box",
              }}
            >
              <div
                className="planCarousel__tile"
                role="group"
                aria-label={`Plan from ${t.lastUsedDate || "history"}`}
              >
                <div className="planCarousel__tileDate">{formatWorkoutDate(t.lastUsedDate)}</div>
                <div className="planCarousel__tileSub">{planSlideSubline(t)}</div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </div>
  );
}
