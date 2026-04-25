import React, { useRef } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { formatWorkoutDate } from "./workoutHelpers.js";

/**
 * Horizontal swipe through past distinct workout plans; first {@code slideChange} from Swiper init is ignored
 * so GET /workout/prefill seed is not overwritten until the user actually changes slides.
 */
export function PlanTemplateCarousel({ templates, loadError, visible, onApplyPlan }) {
  const skipFirstSlideChange = useRef(true);

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
    <div className="planCarousel" aria-label="Recent workout plans">
      <div className="planCarousel__kicker">Plans from history</div>
      <Swiper
        className="planCarousel__swiper"
        slidesPerView={1.12}
        spaceBetween={10}
        centeredSlides={false}
        onSlideChange={(swiper) => {
          if (skipFirstSlideChange.current) {
            skipFirstSlideChange.current = false;
            return;
          }
          const t = templates[swiper.activeIndex];
          if (t && typeof onApplyPlan === "function") onApplyPlan(t);
        }}
      >
        {templates.map((t, i) => (
          <SwiperSlide key={`${t.planKey}-${i}`}>
            <div className="planCarousel__slide">
              <div className="planCarousel__slideLabel">{t.label || "Plan"}</div>
              <div className="planCarousel__slideDate">{formatWorkoutDate(t.lastUsedDate)}</div>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
