package com.goroam.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewOutlineProvider;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import com.google.android.gms.ads.nativead.MediaView;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdView;

import java.util.function.Consumer;

/**
 * ROAM-styled native ad card. The container owns the swipe gesture; the
 * NativeAdView (SDK-clickable assets) and our Skip button are siblings inside it.
 */
class RoamAdCardView extends FrameLayout {

    private final float density;
    private final int touchSlop;
    private final Consumer<String> onDismiss;

    private final NativeAdView adView;
    private final FrameLayout mediaHolder;
    private final TextView pill;
    private final TextView advertiser;
    private final TextView headline;
    private String headlineText;
    private final TextView body;
    private final TextView cta;
    private final GradientDrawable ctaBg;
    private final TextView skip;
    private final GradientDrawable cardBg = new GradientDrawable();
    private final GradientDrawable pillBg = new GradientDrawable();
    private final GradientDrawable skipBg = new GradientDrawable();

    private float downX, downY;
    private boolean dragging;
    private boolean dismissing;
    private VelocityTracker velocity;

    RoamAdCardView(Context context, NativeAd ad, Consumer<String> onDismiss) {
        super(context);
        this.density = context.getResources().getDisplayMetrics().density;
        this.touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        this.onDismiss = onDismiss;

        float radius = dp(24);
        cardBg.setCornerRadius(radius);
        setBackground(cardBg);
        setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
        });
        // No clipToOutline: the rounded background draws itself and the media clips to its own
        // corners, so nothing can clip the SDK's AdChoices glyph in the NativeAdView's corner.
        setElevation(dp(8));
        if (Build.VERSION.SDK_INT >= 28) {
            setOutlineSpotShadowColor(Color.parseColor("#2a2520"));
            setOutlineAmbientShadowColor(Color.parseColor("#2a2520"));
        }

        adView = new NativeAdView(context);
        addView(adView, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // Every child is placed absolutely by setFrame() from AdCardLayout.
        mediaHolder = new FrameLayout(context);
        MediaView media = new MediaView(context);
        media.setImageScaleType(ImageView.ScaleType.CENTER_CROP);
        mediaHolder.addView(media, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        float mediaRadius = dp(16);
        mediaHolder.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), mediaRadius);
            }
        });
        mediaHolder.setClipToOutline(true);
        adView.addView(mediaHolder, new LayoutParams(0, 0));

        pill = label(12, weight(600));
        pill.setText("Sponsored");
        pill.setGravity(Gravity.CENTER);
        pillBg.setCornerRadius(dp(11));
        pill.setBackground(pillBg);
        adView.addView(pill, new LayoutParams(0, 0));

        advertiser = label(13, Typeface.DEFAULT);
        advertiser.setMaxLines(1);
        advertiser.setGravity(Gravity.CENTER_VERTICAL);
        adView.addView(advertiser, new LayoutParams(0, 0));

        Typeface serif = Build.VERSION.SDK_INT >= 28
                ? Typeface.create(Typeface.SERIF, 500, false)
                : Typeface.create(Typeface.SERIF, Typeface.BOLD);
        headline = label(24, serif);
        headline.setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE);
        headline.setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY);
        adView.addView(headline, new LayoutParams(0, 0));

        body = label(15, Typeface.DEFAULT);
        adView.addView(body, new LayoutParams(0, 0));

        cta = label(15, weight(600));
        cta.setTextColor(Color.WHITE);
        cta.setGravity(Gravity.CENTER);
        cta.setPadding(dp(20), 0, dp(20), 0);
        ctaBg = new GradientDrawable();
        ctaBg.setColor(Color.parseColor("#1a3a2f"));
        ctaBg.setCornerRadius(dp(22));
        cta.setBackground(ctaBg);
        cta.setMaxLines(1);
        adView.addView(cta, new LayoutParams(0, 0));

        skip = label(18, Typeface.DEFAULT);
        skip.setText("✕");
        skip.setGravity(Gravity.CENTER);
        skip.setContentDescription("Skip ad");
        skipBg.setShape(GradientDrawable.OVAL);
        skip.setBackground(skipBg);
        skip.setOnClickListener(v -> dismiss("left"));
        addView(skip, new LayoutParams(0, 0));

        headlineText = ad.getHeadline() == null ? "" : ad.getHeadline();
        headline.setText(headlineText);
        body.setText(ad.getBody());
        advertiser.setText(ad.getAdvertiser());
        advertiser.setVisibility(TextUtils.isEmpty(ad.getAdvertiser()) ? INVISIBLE : VISIBLE);
        cta.setText(ad.getCallToAction());
        cta.setVisibility(TextUtils.isEmpty(ad.getCallToAction()) ? GONE : VISIBLE);

        adView.setMediaView(media);
        adView.setHeadlineView(headline);
        adView.setBodyView(body);
        adView.setAdvertiserView(advertiser);
        adView.setCallToActionView(cta);
        adView.setNativeAd(ad);
    }

    void setFrame(int width, int height, boolean dark) {
        layoutCard(width / density, height / density);

        int ink = Color.parseColor(dark ? "#f4ecdc" : "#1a3a2f");
        int text = Color.parseColor(dark ? "#d0c5b0" : "#4a443d");
        int border = Color.parseColor(dark ? "#1f3a30" : "#ede7dc");
        int soft = Color.parseColor(dark ? "#142822" : "#f7f3ed");

        cardBg.setColor(Color.parseColor(dark ? "#1f3a30" : "#ffffff"));
        cardBg.setStroke(Math.max(1, dp(1)), border);
        mediaHolder.setBackgroundColor(Color.parseColor(dark ? "#142822" : "#ede7dc"));
        pillBg.setColor(soft);
        pill.setTextColor(text);
        advertiser.setTextColor(Color.parseColor(dark ? "#8a8275" : "#8a847c"));
        headline.setTextColor(ink);
        body.setTextColor(text);
        skipBg.setColor(soft);
        skipBg.setStroke(Math.max(1, dp(1)), border);
        skip.setTextColor(ink);
        // Forest disappears on the dark card, so dark mode uses gold with forest text
        ctaBg.setColor(Color.parseColor(dark ? "#d4a855" : "#1a3a2f"));
        cta.setTextColor(dark ? Color.parseColor("#1a3a2f") : Color.WHITE);
    }

    private void layoutCard(float w, float h) {
        TextPaint measurePaint = new TextPaint(headline.getPaint());
        AdCardLayout l = AdCardLayout.compute(w, h, headlineText,
                pill.getPaint().measureText("Sponsored") / density,
                cta.getPaint().measureText(cta.getText().toString()) / density,
                body.getLineHeight() / density,
                headlineOverhang(),
                (text, size, widthDp) -> {
                    measurePaint.setTextSize(size * density);
                    return StaticLayout.Builder.obtain(text, 0, text.length(), measurePaint, dp(widthDp))
                            .setIncludePad(false)
                            .setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY)
                            .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
                            .build().getLineCount();
                });

        float pad = AdCardLayout.PAD, width = w - 2 * pad, in = AdCardLayout.INSET;
        place(adView, in, in, w - 2 * in, h - 2 * in);
        place(mediaHolder, in, in, w - 2 * in, l.mediaH);
        place(pill, pad, l.rowY, l.pillW, AdCardLayout.ROW);
        place(advertiser, l.advertiserX, l.rowY, l.advertiserW, AdCardLayout.ROW);

        headline.setTextSize(TypedValue.COMPLEX_UNIT_DIP, l.headlineSize);
        int linePx = Math.round(l.headlineSize * AdCardLayout.LINE * density);
        if (Build.VERSION.SDK_INT >= 28) {
            headline.setLineHeight(linePx);
        } else {
            headline.setLineSpacing(linePx - headline.getPaint().getFontMetricsInt(null), 1f);
        }
        headline.setMaxLines(l.headlineLines);
        place(headline, pad, l.headlineY, width, l.headlineH);

        body.setMaxLines(Math.max(1, l.bodyLines));
        body.setVisibility(TextUtils.isEmpty(body.getText()) || l.bodyLines == 0 ? INVISIBLE : VISIBLE);
        place(body, pad, l.bodyY, width, l.bodyH);

        place(skip, pad, l.buttonsY, AdCardLayout.BUTTON, AdCardLayout.BUTTON);
        place(cta, l.ctaX, l.buttonsY, l.ctaW, AdCardLayout.BUTTON);
    }

    private float headlineOverhang() {
        TextPaint paint = new TextPaint(headline.getPaint());
        paint.setTextSize(100);
        Paint.FontMetrics fm = paint.getFontMetrics();
        return Math.max(0, (fm.descent - fm.ascent) / 100f - AdCardLayout.LINE);
    }

    // x/y are card coordinates; children of the inset NativeAdView are shifted into its space.
    private void place(View view, float x, float y, float w, float h) {
        if (view.getParent() == adView) {
            x -= AdCardLayout.INSET;
            y -= AdCardLayout.INSET;
        }
        LayoutParams lp = (LayoutParams) view.getLayoutParams();
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.leftMargin = dp(x);
        lp.topMargin = dp(y);
        lp.width = dp(w);
        lp.height = dp(h);
        view.setLayoutParams(lp);
    }

    boolean isDismissing() {
        return dismissing;
    }

    void destroy() {
        adView.destroy();
    }

    // Children (e.g. a video MediaView) must not be able to switch off the swipe intercept.
    @Override
    public void requestDisallowInterceptTouchEvent(boolean disallow) {
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent ev) {
        if (dismissing) return true;
        if (ev.getActionMasked() != MotionEvent.ACTION_DOWN) track(ev);
        switch (ev.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                animate().cancel();
                if (velocity != null) velocity.clear();
                track(ev);
                downX = ev.getRawX();
                downY = ev.getRawY();
                dragging = false;
                break;
            case MotionEvent.ACTION_MOVE:
                if (Math.abs(ev.getRawX() - downX) > touchSlop || Math.abs(ev.getRawY() - downY) > touchSlop) {
                    dragging = true;
                    if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                }
                break;
        }
        return dragging;
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        if (dismissing) return true;
        switch (ev.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                // No child took the down (card background): keep the gesture.
                return true;
            case MotionEvent.ACTION_MOVE:
                track(ev);
                float dx = ev.getRawX() - downX;
                float dy = ev.getRawY() - downY;
                if (!dragging && (Math.abs(dx) > touchSlop || Math.abs(dy) > touchSlop)) dragging = true;
                if (dragging) {
                    setTranslationX(dx);
                    setTranslationY(dy);
                    setRotation(reducedMotion() ? 0 : dx / density / 20f);
                }
                return true;
            case MotionEvent.ACTION_UP:
                track(ev);
                release(ev.getRawX() - downX);
                return true;
            case MotionEvent.ACTION_CANCEL:
                release(0);
                return true;
        }
        return true;
    }

    private void release(float dx) {
        float vx = 0;
        if (velocity != null) {
            velocity.computeCurrentVelocity(1000);
            vx = velocity.getXVelocity();
            velocity.recycle();
            velocity = null;
        }
        boolean wasDragging = dragging;
        dragging = false;
        if (!wasDragging) return;

        float dxDp = dx / density;
        float vxDp = vx / density;
        if (Math.abs(dxDp) > 100 || Math.abs(vxDp) > 800) {
            float dir = Math.abs(vxDp) > 800 ? vx : dx;
            dismiss(dir < 0 ? "left" : "right");
        } else if (reducedMotion()) {
            setTranslationX(0);
            setTranslationY(0);
            setRotation(0);
        } else {
            animate().translationX(0).translationY(0).rotation(0)
                    .setDuration(300).setInterpolator(new OvershootInterpolator(1.2f)).start();
        }
    }

    void dismiss(String direction) {
        if (dismissing) return;
        dismissing = true;
        Runnable done = () -> onDismiss.accept(direction);
        if (reducedMotion()) {
            animate().alpha(0).setDuration(200).withEndAction(done).start();
            return;
        }
        View parent = (View) getParent();
        float off = (parent != null ? parent.getWidth() : getWidth()) + getWidth();
        float sign = "left".equals(direction) ? -1 : 1;
        // Rotation stays where the drag left it (0 for a Skip tap), like iOS.
        animate().translationX(sign * off)
                .setDuration(250).withEndAction(done).start();
    }

    private void track(MotionEvent ev) {
        if (velocity == null) velocity = VelocityTracker.obtain();
        // Raw coordinates: local ones shift as the card translates.
        MotionEvent copy = MotionEvent.obtain(ev);
        copy.setLocation(ev.getRawX(), ev.getRawY());
        velocity.addMovement(copy);
        copy.recycle();
    }

    private boolean reducedMotion() {
        return Settings.Global.getFloat(getContext().getContentResolver(),
                Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
    }

    private TextView label(float sizeDp, Typeface typeface) {
        TextView view = new TextView(getContext());
        view.setTextSize(TypedValue.COMPLEX_UNIT_DIP, sizeDp);
        view.setTypeface(typeface);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setIncludeFontPadding(false);
        return view;
    }

    private static Typeface weight(int w) {
        return Build.VERSION.SDK_INT >= 28
                ? Typeface.create(Typeface.DEFAULT, w, false)
                : Typeface.DEFAULT_BOLD;
    }

    private int dp(float v) {
        return Math.round(v * density);
    }
}
