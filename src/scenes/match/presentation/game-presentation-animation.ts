export function completeTimeline(
  timeline: gsap.core.Timeline,
  onComplete?: () => void
): Promise<void> {
  return new Promise((resolve) => {
    timeline.eventCallback('onComplete', () => {
      onComplete?.()
      resolve()
    })
    timeline.eventCallback('onInterrupt', resolve)
  })
}
