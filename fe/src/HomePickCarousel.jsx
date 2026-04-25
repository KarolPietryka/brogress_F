import React from "react";
import { Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/navigation";

/** Placeholder home picker; replace slides with real content when design is ready. */
const DUMMY_SLIDES = [
  { id: "1", label: "Dummy A" },
  { id: "2", label: "Dummy B" },
  { id: "3", label: "Dummy C" },
  { id: "4", label: "Dummy D" },
  { id: "5", label: "Dummy E" },
];

/**
 * Centered strip with arrow nav. Coverflow is omitted here: 3D + app layout was clipping
 * slides to invisibility. Re-apply a visual “big center” later in CSS.
 *
 * `rewind`: on last slide, “next” goes to first; on first, “prev” goes to last.
 */
export function HomePickCarousel() {
  return (
    <div
      data-home-carousel
      style={{ position: "relative", width: "100%", padding: "0 0 4px" }}
    >
      <Swiper
        className="home-pick-swiper"
        modules={[Navigation]}
        navigation
        allowTouchMove={false}
        // Without this, wrapper/slide `height: 100%` chains to 0 when parent only has `minHeight` — slides are clipped (invisible).
        autoHeight
        centeredSlides
        slidesPerView="auto"
        spaceBetween={12}
        rewind
        style={{ width: "100%", padding: "6px 40px" }}
        onInit={(swiper) => {
          swiper.update();
        }}
      >
        {DUMMY_SLIDES.map((slide) => (
          <SwiperSlide
            key={slide.id}
            style={{
              width: 200,
              maxWidth: "80vw",
              boxSizing: "border-box",
            }}
          >
            <div
              role="group"
              aria-label={slide.label}
              className="home-pick-swiper__tile"
            >
              {slide.label}
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
