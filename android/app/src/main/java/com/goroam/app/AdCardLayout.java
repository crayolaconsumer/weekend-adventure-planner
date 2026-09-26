package com.goroam.app;

/**
 * Pure layout maths for RoamAdCardView, in dp, ported from the iOS card's layoutSubviews.
 * Policy: the headline always shows at least its first 25 characters untruncated. It is sized
 * first (24 down to 16, 2 lines, more only if needed), the bottom row keeps its 44 + 20, then
 * the media shrinks from 56% towards max(120, 38%), then the body drops to 1 or 0 lines.
 * All values are in card coordinates. The NativeAdView is inset INSET from the card so the
 * SDK-placed AdChoices (top-right of the ad view) clears the card's 24dp rounded clip.
 */
final class AdCardLayout {

    interface Measure {
        /** Word-wrapped line count of text at the headline font size, for the given width. */
        int headlineLines(String text, float sizeDp, float widthDp);
    }

    static final float PAD = 20, BUTTON = 44, ROW = 22, ROW_GAP = 6, TEXT_GAP = 8, TOP = 16;
    static final float LINE = 1.15f, INSET = 8;

    float mediaH;
    float rowY, pillW, advertiserX, advertiserW;
    float headlineY, headlineSize, headlineH;
    int headlineLines;
    float bodyY, bodyH;
    int bodyLines;
    float buttonsY, ctaX, ctaW;

    static AdCardLayout compute(float w, float h, String headline, float pillTextW, float ctaTextW,
                                float bodyLineH, float headlineOverhang, Measure m) {
        AdCardLayout l = new AdCardLayout();
        float width = w - 2 * PAD;
        l.buttonsY = h - PAD - BUTTON;
        l.ctaW = Math.min(ctaTextW + 40, width - BUTTON - 12);
        l.ctaX = w - PAD - l.ctaW;

        float minMedia = Math.min(h * 0.56f, Math.max(120, h * 0.38f));
        float available = l.buttonsY - TEXT_GAP - (INSET + minMedia + TOP + ROW + ROW_GAP);
        fitHeadline(l, headline, width, available, headlineOverhang, m);
        int fullLines = m.headlineLines(headline, l.headlineSize, width);
        l.headlineH = headlineHeight(Math.min(fullLines, l.headlineLines), l.headlineSize, headlineOverhang);

        float belowMedia = INSET + TOP + ROW + ROW_GAP + l.headlineH + TEXT_GAP + (h - l.buttonsY);
        l.mediaH = (float) Math.max(0, Math.floor(Math.min(h * 0.56f, h - belowMedia)));

        l.rowY = INSET + l.mediaH + TOP;
        l.pillW = (float) Math.ceil(pillTextW) + 20;
        l.advertiserX = PAD + l.pillW + 8;
        l.advertiserW = Math.max(0, w - PAD - l.advertiserX);

        l.headlineY = l.rowY + ROW + ROW_GAP;
        l.bodyY = l.headlineY + l.headlineH + 6;
        l.bodyLines = (int) Math.max(0, Math.min(2, Math.floor((l.buttonsY - TEXT_GAP - l.bodyY) / bodyLineH)));
        l.bodyH = l.bodyLines * bodyLineH;
        return l;
    }

    // Baselines sit size * 1.15 apart; the last line also needs the font's descent below it
    // (overhang = font height / size - 1.15, when positive).
    static float headlineHeight(int lines, float size, float overhang) {
        return lines * size * LINE + overhang * size;
    }

    // Measures through the end of the word holding character 25, plus the ellipsis, because the
    // TextView wraps whole words before it truncates.
    private static void fitHeadline(AdCardLayout l, String text, float width, float available,
                                    float overhang, Measure m) {
        String measured = text;
        if (text.length() > 25) {
            int end = 25;
            while (end < text.length() && !Character.isWhitespace(text.charAt(end))) end++;
            measured = text.substring(0, end) + "…";
        }
        int fallback = 2;
        for (int size = 24; size >= 16; size--) {
            int lines = Math.max(2, m.headlineLines(measured, size, width));
            if (headlineHeight(lines, size, overhang) <= available) {
                l.headlineSize = size;
                l.headlineLines = lines;
                return;
            }
            fallback = lines;
        }
        // Too small a card: keep the text whole and let the media give way.
        l.headlineSize = 16;
        l.headlineLines = fallback;
    }
}
