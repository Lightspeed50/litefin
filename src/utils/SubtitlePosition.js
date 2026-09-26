/**
 * Keep subtitles clear of the OSD without changing saved position settings.
 * Measure the controls themselves: .osd-bottom includes a large gradient padding.
 * Transforms leave the configured top/bottom and text margins intact.
 *
 * @param {HTMLElement} root - Player page element
 * @param {boolean} visible - Whether the main OSD controls are visible
 */
export function updateSubtitlePosition(root, visible) {
    if (!root) return;

    const overlays = root.querySelectorAll('.subtitle-overlay');
    let boundary = Infinity;
    const gap = root.getBoundingClientRect().height * 0.02;
    if (visible) {
        const controls = root.querySelectorAll('.osd-bottom > *');
        for (let i = 0; i < controls.length; i++) {
            const rect = controls[i].getBoundingClientRect();
            if (rect.width && rect.height) boundary = Math.min(boundary, rect.top - gap);
        }
    }

    // Graphic subtitles may contain top-aligned signs or explicitly positioned
    // artwork. Fit the complete frame above the controls rather than cropping it
    // with a translation. A separate parent preserves renderer/style transforms.
    const frames = root.querySelectorAll('.subtitle-renderer-frame');
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        // libass's HTML5 canvas parent has zero height. Its child frame follows
        // the video container instead, while leaving libass's parent untouched.
        if (frame._subtitleViewport) {
            frame.style.height = `${frame._subtitleViewport.clientHeight}px`;
        }
        frame.style.transform = '';
        frame.style.webkitTransform = '';
        if (!visible && !frame._subtitleResize) continue;
        const rect = frame.getBoundingClientRect();
        if (!rect.height) continue;
        const scale = visible ? Math.max(0, Math.min(1, (boundary - rect.top) / rect.height)) : 1;
        if (frame._subtitleResize) {
            const width = rect.width * scale;
            const height = rect.height * scale;
            const left = (rect.width - width) / 2;
            const size = `${width},${height},${left}`;
            if (frame._subtitleSize !== size) {
                frame._subtitleResize(width, height, left);
                frame._subtitleSize = size;
            }
            continue;
        }
        if (scale < 1) {
            frame.style.transform = `scale(${scale})`;
            frame.style.webkitTransform = frame.style.transform;
        }
    }

    for (let i = 0; i < overlays.length; i++) {
        const overlay = overlays[i];
        // Measure at the original position, avoiding cumulative movement on updates.
        overlay.style.transform = '';
        overlay.style.webkitTransform = '';
        if (!visible || overlay.classList.contains('hidden')) continue;

        const line = overlay.querySelector('.subtitle-line');
        if (!line) continue;
        const rect = line.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const offset = Math.max(0, rect.bottom - boundary);
        if (offset) {
            const transform = `translateY(-${offset}px)`;
            overlay.style.transform = transform;
            overlay.style.webkitTransform = transform;
        }
    }
}

/** Mount a renderer in an independent, full-size OSD avoidance frame. */
export function mountSubtitleFrame(container, element, viewport = null, resize = null) {
    const frame = document.createElement('div');
    frame.className = 'subtitle-renderer-frame';
    frame.style.position = 'absolute';
    frame.style.top = '0';
    frame.style.left = '0';
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame._subtitleViewport = viewport;
    frame._subtitleResize = resize;
    if (viewport) frame.style.height = `${viewport.clientHeight}px`;
    frame.style.pointerEvents = 'none';
    frame.style.zIndex = element.style.zIndex || '30';
    frame.style.transformOrigin = '50% 0';
    frame.style.webkitTransformOrigin = '50% 0';
    container.appendChild(frame);
    frame.appendChild(element);

    // Tracks can finish loading while paused with the OSD already open.
    const root = container.closest('.player-page');
    if (root) updateSubtitlePosition(root, !!root.querySelector('.osd-main:not(.osd-hidden)'));
}

/** Restore the original parent before a renderer disposes or replaces its DOM. */
export function unwrapSubtitleFrame(element) {
    const frame = element && element.parentNode;
    if (!frame || !frame.classList.contains('subtitle-renderer-frame') || !frame.parentNode) return;
    const container = frame.parentNode;
    container.insertBefore(element, frame);
    container.removeChild(frame);
}
