import type { ReactNode } from 'react'

export interface Method {
  title: string
  /** Figure numbers this method draws, as printed on the figures. */
  figs?: readonly string[]
  body: ReactNode
  formula?: readonly string[]
  cite?: readonly string[]
}

/** `chapter` is a chapter number from CHAPTERS, or null for the conventions every chapter shares. */
export interface MethodSection {
  chapter: number | null
  intro: ReactNode
  methods: readonly Method[]
}

const PHILLIPS = 'Phillips AJK et al. Irregular sleep/wake patterns are associated with poorer academic performance and delayed circadian and sleep/wake timing. Sci Rep 2017;7:3216.'
const LEYS = 'Leys C et al. Detecting outliers: do not use standard deviation around the mean, use absolute deviation around the median. J Exp Soc Psychol 2013;49:764–766.'
const BH = 'Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. J R Stat Soc B 1995;57:289–300.'
const TASK_FORCE = 'Task Force of the ESC and NASPE. Heart rate variability: standards of measurement, physiological interpretation and clinical use. Circulation 1996;93:1043–1065.'
const WHO_2020 = 'Bull FC et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med 2020;54:1451–1462.'

export const SECTIONS: readonly MethodSection[] = [
  {
    chapter: null,
    intro: 'A few rules apply on every page. They decide which minutes count, which night a minute belongs to, and how a noisy daily value becomes a trend.',
    methods: [
      {
        title: 'Night D',
        body: (
          <>
            <p>
              Night D is the sleep that starts after noon on calendar day D. It runs from noon on D to noon on D + 1, so an episode that crosses midnight is never split in two. Values
              measured during that sleep, such as sleeping heart rate or night HRV, belong to night D. Resting heart rate is the value the watch reports for the morning after.
            </p>
          </>
        ),
      },
      {
        title: 'The main sleep episode',
        body: (
          <>
            <p>
              The watch often records a night as several asleep segments with brief wakings between them. Segments staged Core, REM or Deep are joined into one cluster whenever the gap
              between them is 60 minutes or less. The cluster holding the most sleep is the night’s main episode. Its first asleep minute is onset and its last is final wake. Unstaged “Asleep” records, from older watches or other apps, count as Core.
            </p>
            <p>A night counts only when its main episode holds at least 3 h of sleep. Naps and short fragments outside the main episode are not counted as the night’s sleep.</p>
          </>
        ),
      },
      {
        title: 'Choosing a source',
        body: (
          <>
            <p>
              An iPhone, a watch and third-party apps can all write the same kind of record. Adding them up would double-count, so one source is chosen per day for most records. Heart
              rate comes from the source with the most samples that day. Sleep comes from the source with the most staged minutes that night. Steps take the largest value any source
              reports in each 10-minute bin. HRV, SpO2 and time in daylight pool every source.
            </p>
            <p>A change of device can shift a baseline, because sensors and algorithms differ. Fig. 1.4 shows which source supplied each day.</p>
          </>
        ),
      },
      {
        title: 'Wear time',
        body: (
          <p>
            A minute counts as worn when a heart-rate sample lies within 15 minutes of it. A day is valid for the measures that need a full day, such as sleep regularity and the step
            rhythm indices, when the watch was worn for more than 60% of it. The heart-rate rhythm indices need heart rate in more than 90% of the day’s hours. A day without wear is
            missing, never zero.
          </p>
        ),
      },
      {
        title: 'Clock times',
        body: (
          <p>
            Bedtimes cluster around midnight, so averaging raw clock hours fails: 23:30 and 00:30 would average to noon. Clock times are placed on a noon-to-noon scale before any median
            is taken, so 00:30 sits just after 23:30. Where a single typical time of day is needed, the mean is circular: each time is a point on a 24 h circle and the mean is the
            direction of their average. Its length R runs from 0 (spread evenly) to 1 (all at the same minute).
          </p>
        ),
        formula: ['mean time = arg( mean( e^(i·2π·t/24) ) ) × 24 / 2π', 'R = | mean( e^(i·2π·t/24) ) |'],
      },
      {
        title: 'Trend lines and bands',
        body: (
          <p>
            Dots are single days or nights. The line through them is a centred 14-day rolling median and the ribbon its interquartile range, the middle half of the values in the
            window. A point is drawn once at least four values fall in its window. Medians are used throughout so one unusual night does not bend the trend.
          </p>
        ),
      },
      {
        title: 'Robust spread',
        body: (
          <p>
            Where a value is compared against a typical level, the typical level is the median and the spread is 1.4826 × the median absolute deviation (MAD). For normally
            distributed data that spread equals the standard deviation, but a few extreme days cannot inflate it.
          </p>
        ),
        formula: ['MAD = median( |x − median(x)| )', 'robust z = (x − median) / (1.4826 × MAD)'],
        cite: [LEYS],
      },
      {
        title: 'No invented scores',
        body: (
          <p>
            Nothing on these pages is a composite score. Each figure shows a measured quantity or a published statistic of it, and reference values come from the cited guidelines.
            Comparisons are within one person and are associations, not causes.
          </p>
        ),
      },
    ],
  },
  {
    chapter: 1,
    intro: 'The overview summarises the selected range and sets it against the period just before it.',
    methods: [
      {
        title: 'Vital signs and their change',
        figs: ['1.1'],
        body: (
          <>
            <p>
              Each tile shows the median of the metric across the selected range. Sleep regularity is the mean instead. Amplitude and acrophase leave out days whose cosinor fit explains
              less than 15% of the variance.
            </p>
            <p>
              The change compares the range against the equal-length period just before it. Green and red say whether the move is in the healthy direction for that metric. Clock times
              have no healthy direction, so they are not colored. The sparkline is the mean of each 7-day block.
            </p>
          </>
        ),
      },
      {
        title: 'Actogram and four trends',
        figs: ['1.2', '1.3'],
        body: (
          <p>
            The actogram draws one row per day, midnight to midnight, with each minute colored by its sleep stage. The trend panels use the rolling median and band described above.
            Their scales leave out dots below the 2nd and above the 98th percentile so a single outlier does not flatten the rest.
          </p>
        ),
      },
      {
        title: 'Where the data came from',
        figs: ['1.4'],
        body: (
          <p>
            One cell per day and record type. For heart rate and sleep it is the source chosen under the rules above. For steps it is the source with the largest daily total, and for
            the pooled records the one with the most samples. The reading dates the last change of heart-rate source that held for a week or more, since a new device is the most common cause of a sudden step in a baseline.
          </p>
        ),
      },
    ],
  },
  {
    chapter: 2,
    intro: 'Sleep metrics are computed from the main episode of each night and the watch’s own minute-by-minute stages.',
    methods: [
      {
        title: 'Timing',
        figs: ['2.1', '2.2'],
        body: (
          <p>
            Onset and final wake are the first and last asleep minutes of the main episode. Mid-sleep is halfway between them. All three are read on the noon-to-noon scale, and the
            actogram draws each row from noon to noon so the night sits in the middle.
          </p>
        ),
        formula: ['mid-sleep = (onset + final wake) / 2'],
      },
      {
        title: 'Duration and efficiency',
        figs: ['2.3', '2.4'],
        body: (
          <p>
            Total sleep counts the minutes staged Core, REM or Deep inside the main episode. Efficiency divides it by the episode’s length. Awake in bed counts the minutes staged Awake
            between onset and final wake. Deep and REM shares are fractions of total sleep, not of time in bed, so a restless night does not lower them. The stages are the watch’s own
            classification.
          </p>
        ),
        formula: ['total sleep = Core + REM + Deep', 'efficiency = total sleep / (final wake − onset) × 100', 'Deep % = Deep / total sleep × 100'],
      },
      {
        title: 'The shape of a typical night',
        figs: ['2.5'],
        body: (
          <>
            <p>
              Every main episode is aligned at its onset, and the first 10 hours are kept. At each minute after onset, the chart shows the fraction of nights in that minute staged
              Deep, Core, REM or Awake. Nights that have already ended count toward none, so the stack thins toward morning.
            </p>
            <p>
              The transition matrix is a first-order Markov estimate. Each run of one stage is collapsed to a single step, and each cell is the share of the steps out of the row’s
              stage that go to the column’s stage. The diagonal is empty by construction.
            </p>
          </>
        ),
        formula: ['P(a → b) = transitions from a to b / all transitions out of a'],
      },
      {
        title: 'Chronotype and social jet lag',
        figs: ['2.6'],
        body: (
          <>
            <p>
              Following the Munich ChronoType Questionnaire, mid-sleep on free days, corrected for oversleep (MSFsc), is the standard marker of chronotype. Here free days are Friday and Saturday nights and all
              other nights are work nights. MSF and MSW are the medians of mid-sleep on each.
            </p>
            <p>
              People often sleep longer on free days to repay a weekday debt, which pushes MSF later. MSFsc corrects for that. When free-day sleep is longer than work-day sleep, it
              moves MSF earlier by half the difference. This is a simplified form of the MCTQ correction, which uses the weekly average sleep duration in place of work-day
              sleep. Social jet lag is the gap between free-day and work-day mid-sleep.
            </p>
          </>
        ),
        formula: ['MSFsc = MSF − (SDf − SDw) / 2   when SDf > SDw', 'social jet lag = | MSF − MSW |'],
        cite: ['Roenneberg T, Wirz-Justice A, Merrow M. Life between clocks: daily temporal patterns of human chronotypes. J Biol Rhythms 2003;18:80–90.'],
      },
      {
        title: 'Sleep Regularity Index',
        figs: ['2.7'],
        body: (
          <p>
            The SRI asks how likely you are to be in the same state, asleep or awake, at the same minute on two consecutive days. Every minute of day D is compared with the same
            minute of day D + 1. The share that agree is rescaled so 100 means identical days and 0 means no more alike than chance. Both days must be valid wear days.
          </p>
        ),
        formula: ['SRI = 200 × P(same state 24 h apart) − 100'],
        cite: [PHILLIPS],
      },
      {
        title: 'Nights of seven hours or more',
        figs: ['2.8'],
        body: (
          <>
            <p>
              The American Academy of Sleep Medicine and the Sleep Research Society recommend at least 7 h of sleep a night for adults. Each week, Monday to Sunday, shows the share
              of recorded nights that reached it. This is a population floor, not a measure of your own sleep need.
            </p>
            <p>
              The shortfall line adds up how far each night fell below 7 h over that night and the 13 recorded nights before it. Long nights do not pay back short ones, so the line
              only measures the debt that accumulated.
            </p>
          </>
        ),
        formula: ['shortfall = Σ over 14 recorded nights of max(0, 7 h − total sleep)'],
        cite: ['Watson NF et al. Recommended amount of sleep for a healthy adult. Sleep 2015;38:843–844.'],
      },
    ],
  },
  {
    chapter: 3,
    intro: 'Heart rate and movement both rise by day and fall at night. These methods measure how strong, how steady and how well timed that daily cycle is.',
    methods: [
      {
        title: 'Heart-rate and activity actograms',
        figs: ['3.1', '3.2'],
        body: (
          <p>
            Heart rate is averaged into 5-minute bins and steps are summed into 10-minute bins, one row per day. Heart-rate color spans the 2nd to the 98th percentile of the range,
            so a few workouts do not wash out the contrast between night and day. Step color runs on a square-root scale up to the 98th percentile.
          </p>
        ),
      },
      {
        title: 'Cosinor fit',
        figs: ['3.3'],
        body: (
          <>
            <p>
              For each day, a 24-hour cosine is fitted by least squares to 5-minute heart rate across a 3-day window centred on that day. The fit needs at least 40% of the window
              covered. MESOR is the rhythm-adjusted mean, amplitude is half the swing from peak to trough, and acrophase is the clock time of the fitted peak.
            </p>
            <p>
              R² is the share of the variance the cosine explains. Days under 0.15 are hidden, because the fitted peak of a weak rhythm is mostly noise. Acrophase is unwrapped around
              its circular median so a peak near midnight does not jump across the axis.
            </p>
          </>
        ),
        formula: ['HR(t) = MESOR + A · cos(2π·t / 24 − φ)', 'acrophase = φ × 24 / 2π   (hours from midnight)'],
        cite: ['Cornelissen G. Cosinor-based rhythmometry. Theor Biol Med Model 2014;11:16.'],
      },
      {
        title: 'Non-parametric rhythm indices',
        figs: ['3.4'],
        body: (
          <>
            <p>
              These indices make no assumption about the shape of the daily curve. Each is computed on hourly steps and hourly heart rate across a 14-day sliding window, from days with
              enough wear. A window needs at least 7 such days.
            </p>
            <p>
              Interdaily stability (IS, 0 to 1) is high when every day looks like the average day. Intradaily variability (IV, 0 to about 2) is high when activity flips on and off
              within the day. Relative amplitude (RA, 0 to 1) compares the most active 10 hours (M10) with the least active 5 hours (L5). M10 and L5 onsets are the clock hours at
              which those windows start.
            </p>
          </>
        ),
        formula: [
          'IS = n · Σₕ (x̄ₕ − x̄)² / (24 · Σᵢ (xᵢ − x̄)²)',
          'IV = n · Σᵢ (xᵢ − xᵢ₋₁)² / ((n − 1) · Σᵢ (xᵢ − x̄)²)',
          'RA = (M10 − L5) / (M10 + L5)',
        ],
        cite: ['Van Someren EJW et al. Bright light therapy: improved sensitivity to its effects on rest-activity rhythms in Alzheimer patients by application of nonparametric methods. Chronobiol Int 1999;16:505–518.'],
      },
      {
        title: 'Periodogram',
        figs: ['3.5'],
        body: (
          <p>
            A Lomb-Scargle periodogram asks how much of a signal’s variation repeats at each cycle length. It is evaluated on hourly heart rate and hourly steps at 1,200 periods spaced
            evenly on a log scale from 2.5 hours to 16 days. Unlike a Fourier transform it handles the gaps left by unworn hours without filling them in. A strong circadian rhythm is
            one sharp peak near 24 h. The dominant period is the highest heart-rate peak between 20 and 28 hours. Power is normalised per signal, so compare peak positions, not heights.
          </p>
        ),
        cite: ['Lomb NR. Least-squares frequency analysis of unequally spaced data. Astrophys Space Sci 1976;39:447–462.', 'Scargle JD. Studies in astronomical time series analysis II. Astrophys J 1982;263:835–853.'],
      },
    ],
  },
  {
    chapter: 4,
    intro: 'Night is the cleanest window onto the heart, because posture, movement and food are mostly out of the picture.',
    methods: [
      {
        title: 'Resting and sleeping heart rate',
        figs: ['4.1'],
        body: (
          <p>
            Resting heart rate is the watch’s own daily estimate, assigned to the night before it. Sleeping heart rate is the mean of minute heart rate inside the main episode, and its
            floor is the 5th percentile, a low point that one artefact cannot set.
          </p>
        ),
      },
      {
        title: 'Heart-rate variability (SDNN)',
        figs: ['4.2'],
        body: (
          <p>
            The watch takes short HRV readings at rest and reports SDNN, the standard deviation of the intervals between beats. Night HRV is the mean of the readings inside the main
            episode, on nights with at least two. Higher values usually mean stronger vagal, rest-and-digest activity, and the trend within one person says more than the level.
          </p>
        ),
      },
      {
        title: 'Nocturnal dip',
        figs: ['4.3'],
        body: (
          <p>
            Heart rate normally falls during sleep. The dip compares sleeping heart rate with daytime heart rate, the mean between 10:00 and 20:00 on day D. A dip under 10% is
            conventionally called non-dipping.
          </p>
        ),
        formula: ['dip = (daytime HR − sleeping HR) / daytime HR × 100'],
      },
      {
        title: 'Oxygen and breathing',
        figs: ['4.4'],
        body: <p>SpO2 is the mean of blood-oxygen samples during sleep, and its floor the 5th percentile. Respiratory rate is the mean of the watch’s breathing-rate samples during sleep. Each needs at least two samples in the night.</p>,
      },
      {
        title: 'Heart rate against movement',
        figs: ['4.5'],
        body: (
          <p>
            Every 10-minute bin with both measures adds one count to a 2D histogram of step total against mean heart rate. Color is log(1 + count), so rare and common cells both stay
            visible. The median curve is the median heart rate within step bands (0, 1–49, 50–99, 100–199, then bands 100 to 400 steps wide up to 1,399), drawn where a band holds more than 30 bins.
          </p>
        ),
      },
      {
        title: 'Monthly distribution',
        figs: ['4.6'],
        body: (
          <p>
            For each month, minute heart rate is split into asleep and awake by the sleep record and smoothed with a Gaussian kernel density estimate (bandwidth factor 0.15) on a 1 bpm
            grid. A month needs at least 200 samples per state, and at most 15,000 are drawn at random to keep it fast. Each curve is scaled to its own peak, so ridges compare shape and
            position rather than amount.
          </p>
        ),
      },
      {
        title: 'Off your baseline',
        figs: ['4.7'],
        body: (
          <>
            <p>
              Each night is set against the 28 calendar nights before it, never including itself. The baseline is the median of those with a value and the spread is 1.4826 × their MAD, which gives a robust z
              for the night. At least 14 of the 28 must have the signal.
            </p>
            <p>
              A signal is flagged when it is 2 or more spreads away in the direction that departs from health. That is resting heart rate, sleeping heart rate, respiratory rate and
              wrist temperature going up, and HRV and SpO2 going down. Studies of wearable data have seen these signals leave a person’s own baseline in the days before an infection
              was diagnosed. The figure counts how many moved together and forms no score. It is not a diagnosis. Alcohol, travel, hard training or a late meal can do the same.
            </p>
          </>
        ),
        formula: ['z = (tonight − median of the 28 nights before) / (1.4826 × MAD)', 'flag when z ≥ 2 in the concerning direction'],
        cite: [LEYS, 'Radin JM et al. Harnessing wearable device data to improve state-level real-time surveillance of influenza-like illness in the USA. Lancet Digit Health 2020;2:e85–e93.', 'Mishra T et al. Pre-symptomatic detection of COVID-19 from smartwatch data. Nat Biomed Eng 2020;4:1208–1220.'],
      },
      {
        title: 'Beat-to-beat HRV (RMSSD)',
        figs: ['4.8'],
        body: (
          <>
            <p>
              Each HRV reading also stores the time of every beat. RR intervals are the gaps between successive beats, and RMSSD is the root mean square of the differences between
              successive intervals. It mainly reflects vagal activity. An interval shorter than 300 ms or longer than 2,000 ms is dropped along with every difference it takes part in,
              and a reading needs at least 20 valid differences.
            </p>
            <p>
              A night’s RMSSD is the mean over readings inside the main episode, on nights with at least two. The line is a trailing 7-night mean of ln RMSSD, shown when at least 3 of
              the 7 nights have a value, and the band is the same 28-night robust baseline as Fig. 4.7. Beat times resolve to 10 ms, coarser than laboratory ECG, so values are
              approximate.
            </p>
          </>
        ),
        formula: ['RRᵢ = tᵢ₊₁ − tᵢ', 'RMSSD = √( mean( (RRᵢ₊₁ − RRᵢ)² ) )'],
        cite: [TASK_FORCE, 'Plews DJ et al. Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring. Sports Med 2013;43:773–781.'],
      },
    ],
  },
  {
    chapter: 5,
    intro: 'These methods look for metrics that move together across days, and for what tends to come before a better or worse night.',
    methods: [
      {
        title: 'Correlation matrix',
        figs: ['5.1', '5.2'],
        body: (
          <>
            <p>
              Spearman’s ρ is the correlation of ranks. It captures any relationship where one metric rises as the other rises, straight or curved, and one extreme day cannot dominate
              it. Each pair uses only the days where both metrics exist.
            </p>
            <p>
              Testing many pairs at once guarantees some false alarms, so all p-values are adjusted together with the Benjamini–Hochberg procedure. A dot marks a pair whose false
              discovery rate q is under 0.05, which means at most about one in twenty dotted cells is expected to be a fluke. Rows are ordered by average-linkage clustering on 1 − |ρ|, so
              metrics that move together, in either direction, sit side by side.
            </p>
            <p>The pair scatter draws one dot per day, with a trend line through the medians of eight equal-count bins along x.</p>
          </>
        ),
        formula: ['ρ = Pearson correlation of rank(x) and rank(y)', 'distance = 1 − |ρ|'],
        cite: [BH],
      },
      {
        title: 'Daily state',
        figs: ['5.3'],
        body: (
          <p>
            Each metric is first smoothed with a centred 7-day rolling mean that needs 3 values. Every day is then expressed as a robust z against the median and MAD of that smoothed
            series across the range, and clipped to ±3. Rows follow the clustered order of Fig. 5.1, so related metrics light up as blocks.
          </p>
        ),
      },
      {
        title: 'Before the night',
        figs: ['5.4'],
        body: (
          <>
            <p>
              An exposure sorts nights into groups, such as how long before sleep the last workout ended, or gives each night a number, such as minutes of daylight in the first two
              hours after waking. A hard workout is one at or above your median workout training load. Outcomes are measures of that night: total sleep, Deep and REM share, awake in
              bed, night HRV, sleeping heart rate, next-day resting heart rate and onset.
            </p>
            <p>
              Each group is compared with the reference group by the difference in medians. Its 95% confidence interval comes from 2,000 bootstrap resamples, and its p-value from a
              two-sided Mann–Whitney U test. A group needs at least 5 nights. Numeric exposures use Spearman’s ρ over at least 10 nights. Benjamini–Hochberg adjusts the p-values of
              one exposure together.
            </p>
            <p>These are associations between nights of one person. A late workout and a short night may both follow from a busy day.</p>
          </>
        ),
        formula: ['effect = median(group) − median(reference)', '95% CI = 2.5th and 97.5th percentiles of 2,000 bootstrap differences'],
        cite: [BH, 'Mann HB, Whitney DR. On a test of whether one of two random variables is stochastically larger than the other. Ann Math Stat 1947;18:50–60.', 'Efron B, Tibshirani RJ. An Introduction to the Bootstrap. Chapman & Hall, 1993.'],
      },
      {
        title: 'Journal tags',
        figs: ['5.5'],
        body: (
          <p>
            Tags record what the export cannot see. A day you open and mark, with a tag or with nothing to note, counts as reviewed. A day you never opened counts for neither side.
            Nights after a tagged day are compared with nights after reviewed days without the tag, by the same statistics as Fig. 5.4, once each side has at least 5 nights.
          </p>
        ),
      },
    ],
  },
  {
    chapter: 6,
    intro: 'Walking speed is one of the strongest single predictors of health in older adults, and the iPhone measures it passively.',
    methods: [
      {
        title: 'Gait',
        figs: ['6.1'],
        body: (
          <p>
            The iPhone measures walking speed, step length, double-support time and asymmetry during steady walks while carried at the hip or in a pocket. Each day is the median of
            that day’s samples. The rolling window is 14 days when a metric has a value on at least 60% of days, and 28 days otherwise.
          </p>
        ),
        cite: ['Studenski S et al. Gait speed and survival in older adults. JAMA 2011;305:50–58.'],
      },
      {
        title: 'Daily activity',
        figs: ['6.2', '6.3'],
        body: (
          <p>
            Steps take the largest value any source reports in each 10-minute bin, summed per day. Active energy is the watch’s daily total. The weekly shape uses the median of daily
            totals per weekday, and the hourly profile the median and interquartile range of hourly totals across days, so one long hike does not set the shape of a typical day.
          </p>
        ),
      },
    ],
  },
  {
    chapter: 7,
    intro: 'The watch records a 30-second single-lead ECG on request. These methods find each heartbeat in the raw voltage.',
    methods: [
      {
        title: 'Filtering and R-peaks',
        figs: ['7.2', '7.3'],
        body: (
          <p>
            The trace is band-pass filtered from 0.5 to 40 Hz with a second-order Butterworth filter, run forward and backward so peaks do not shift in time. The low edge removes
            baseline wander from breathing and movement, and the high edge removes muscle and mains noise. R-peaks are local maxima at least 330 ms apart whose prominence reaches 45% of
            the trace’s 99th percentile. RR intervals are the times between consecutive peaks, and mean heart rate is 60,000 / mean RR.
          </p>
        ),
        formula: ['HR = 60 000 / mean RR (ms)', 'RMSSD = √( mean( (RRᵢ₊₁ − RRᵢ)² ) )'],
      },
      {
        title: 'Poincaré plot',
        figs: ['7.4'],
        body: (
          <p>
            Each RR interval is plotted against the next. SD1, the spread across the identity line, reflects beat-to-beat variability. SD2, the spread along it, reflects slower
            changes. The ellipse is centred on the mean RR.
          </p>
        ),
        formula: ['SD1 = SD(RRᵢ₊₁ − RRᵢ) / √2', 'SD2 = √( 2·SDNN² − SD1² )'],
        cite: ['Brennan M, Palaniswami M, Kamen P. Do existing measures of Poincaré plot geometry reflect nonlinear features of heart rate variability? IEEE Trans Biomed Eng 2001;48:1342–1347.'],
      },
      {
        title: 'Ensemble beat',
        figs: ['7.5'],
        body: (
          <p>
            Each beat is cut from 250 ms before to 450 ms after its R-peak and the beats are overlaid. Their sample-by-sample median is a clean template of the P wave, QRS complex and
            T wave. Recordings with many beats are thinned for drawing; the median uses all of them.
          </p>
        ),
      },
    ],
  },
  {
    chapter: 8,
    intro: 'Fitness sets weekly activity against public-health guidelines and weighs each workout by how hard the heart worked.',
    methods: [
      {
        title: 'Weekly aerobic activity',
        figs: ['8.1'],
        body: (
          <p>
            The watch logs physical effort in kcal/hr·kg, which is numerically the same as METs, multiples of resting energy use. Minutes at 3.0–5.9 METs count as moderate and minutes
            at 6.0 or more as vigorous, in the Monday-to-Sunday week where the sample starts. The WHO recommends 150–300 moderate minutes a week, where one vigorous minute counts as
            two. A week without a single effort sample is missing, not zero.
          </p>
        ),
        formula: ['guideline minutes = moderate + 2 × vigorous'],
        cite: [WHO_2020, 'Ainsworth BE et al. 2011 Compendium of Physical Activities. Med Sci Sports Exerc 2011;43:1575–1581.'],
      },
      {
        title: 'Heart-rate intensity',
        figs: ['8.2'],
        body: (
          <p>
            Each minute with heart rate is placed on the heart-rate reserve, the range between resting and maximum heart rate. Resting heart rate is that day’s value, or the median of
            the previous 28 days when the day has none. Maximum heart rate is estimated from age. Moderate is 40–59% of reserve and vigorous is 60% or more. Outside workouts the watch
            samples heart rate only every few minutes, so these are lower bounds.
          </p>
        ),
        formula: ['HRR = (HR − HRrest) / (HRmax − HRrest)', 'HRmax = 208 − 0.7 × age'],
        cite: ['Karvonen MJ, Kentala E, Mustala O. The effects of training on heart rate. Ann Med Exp Biol Fenn 1957;35:307–315.', 'Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. J Am Coll Cardiol 2001;37:153–156.', 'Garber CE et al. ACSM position stand. Med Sci Sports Exerc 2011;43:1334–1359.'],
      },
      {
        title: 'Training load (TRIMP)',
        figs: ['8.3'],
        body: (
          <p>
            Banister’s training impulse weights each workout minute by its heart-rate reserve fraction r, clipped to 0–1. The exponential weighting makes a hard minute count several
            times an easy one, following how blood lactate rises with intensity. The coefficients differ for men and women. Minutes covered by two overlapping workouts, such as one
            session logged by two apps, count once.
          </p>
        ),
        formula: ['TRIMP = Σ minutes × r × a · e^(b·r)', 'men: a = 0.64, b = 1.92    women: a = 0.86, b = 1.67'],
        cite: ['Morton RH, Fitz-Clarke JR, Banister EW. Modeling human performance in running. J Appl Physiol 1990;69:1171–1177.'],
      },
      {
        title: 'Muscle strengthening',
        figs: ['8.4'],
        body: (
          <p>
            The WHO recommends muscle-strengthening activity on two or more days a week. A day counts once however many sessions it holds. Strength workouts are those logged as
            traditional strength training, functional strength training or core training.
          </p>
        ),
        cite: [WHO_2020],
      },
      {
        title: 'Steps against the evidence',
        figs: ['8.5'],
        body: (
          <p>
            A meta-analysis of 15 cohorts found the risk of death falling with more daily steps up to a plateau: about 6,000–8,000 steps a day for adults 60 and over, and 8,000–10,000
            for younger adults. The band drawn is the one for your age, or both when no age is set.
          </p>
        ),
        cite: ['Paluch AE et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. Lancet Public Health 2022;7:e219–e228.'],
      },
      {
        title: 'Cardiorespiratory fitness',
        figs: ['8.6'],
        body: (
          <p>
            VO2max is the watch’s estimate from outdoor walks, runs and hikes. Across 33 cohorts, each 1 MET (3.5 mL/min·kg) of higher fitness went with about 13% lower all-cause
            mortality. The watch’s estimate differs from a laboratory test by about 13% on average, so its trend says more than its level. Heart-rate recovery is the drop in the first
            minute after a workout ends; on a treadmill test, 12 bpm or less was abnormal. Walking heart rate is the day’s average while walking.
          </p>
        ),
        cite: [
          'Kodama S et al. Cardiorespiratory fitness as a quantitative predictor of all-cause mortality and cardiovascular events. JAMA 2009;301:2024–2035.',
          'Lambe R et al. PLOS ONE 2025.',
          'Cole CR et al. Heart-rate recovery immediately after exercise as a predictor of mortality. N Engl J Med 1999;341:1351–1357.',
        ],
      },
    ],
  },
  {
    chapter: 9,
    intro: 'Light sets the circadian clock, and sound adds up to a dose. Both are read from the watch’s sensors.',
    methods: [
      {
        title: 'Daylight',
        figs: ['9.1'],
        body: (
          <p>
            Time in daylight is the watch’s estimate of time outdoors in daylight, from its ambient light sensor. A day counts only when the watch that logs daylight was worn for more than 60% of it.
            Morning daylight is the part of those minutes in the first two hours after the wake time that began the day. A sample that straddles the edge counts for the share inside,
            and a morning counts only when the watch was worn for at least half of it. There is no accepted target number of minutes, so none is drawn.
          </p>
        ),
        cite: ['Burns AC et al. Day and night light exposure are associated with psychiatric disorders. Nat Ment Health 2023.', 'Wright KP Jr et al. Entrainment of the human circadian clock to the natural light-dark cycle. Curr Biol 2013;23:1554–1558.'],
      },
      {
        title: 'The year, week by week',
        figs: ['9.2'],
        body: (
          <p>
            For each ISO week of each year, the median of that week’s daily values, from weeks with at least 3 days. Then for each week number 1 to 53, the median of those weekly
            medians across years, with the 25th and 75th percentiles when two or more years contribute. This figure reads the whole dataset, not only the selected range. It is
            descriptive only: weather, travel, work or a new device can all make a seasonal pattern.
          </p>
        ),
      },
      {
        title: 'Sound dose',
        figs: ['9.3'],
        body: (
          <p>
            The WHO safe-listening standard gives an adult a weekly allowance of 1.6 Pa²h, the sound energy of 80 dBA for 40 hours. Every 3 dB louder doubles the energy, so it halves
            the safe time. Each sample’s level is taken as the equivalent continuous level over its duration, and each week shows its total as a share of the allowance. Headphone
            levels are estimated from volume and the known output of the headphones, most accurately with Apple and Beats models. For environmental sound the percentage is context,
            not a limit.
          </p>
        ),
        formula: ['dose % = Σ hours × 10^((L − 80) / 10) / 40 × 100'],
        cite: ['ITU-T H.870 (03/2022). Guidelines for safe listening devices/systems.', 'World Health Organization, International Telecommunication Union. Safe listening devices and systems: a WHO-ITU standard. Geneva: WHO; 2019.'],
      },
    ],
  },
]
