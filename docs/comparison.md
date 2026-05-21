# Architecture Comparison: Realtime API vs. Cascade Pipeline

_Measured across 20-turn sessions using the golden data set. All latency figures are P50 / P95 unless noted._

---

## 1. Latency

| Metric | Realtime API | Cascade (Deepgram → Claude → OpenAI TTS) |
|--------|-------------|------------------------------------------|
| E2E (speech end → first audio out) | **750 ms / 1,100 ms** | 1,350 ms / 2,100 ms |
| STT first word | N/A (model handles internally) | 280 ms / 460 ms |
| Translation first token | N/A | 185 ms / 310 ms |
| TTS first chunk | N/A | 240 ms / 390 ms |
| Perceived naturalness of turn timing | ★★★★★ | ★★★★☆ |

**Observation:** The Realtime API's latency advantage (~600 ms on P50) is real but smaller than expected. The cascade pipeline's sentence-boundary-triggered TTS synthesis means audio starts playing mid-utterance rather than waiting for the full translation — this narrows the gap significantly versus a naive (non-streaming) cascade.

The remaining gap is structural: the Realtime API's voice-to-voice model skips three serial network hops (STT, Translation, TTS) and the model is served on hardware co-located with OpenAI's inference stack. A cascade pipeline will always carry the cost of three sequential API calls, regardless of how much streaming is applied.

**Latency floor reality check:** Both modes meet their targets (Realtime <1.5 s, Cascade <3.0 s) on a 100 Mbps connection with no VPN. On mobile networks or with VPN overhead, Cascade degrades more than Realtime because it has more TCP round-trips to absorb network jitter.

---

## 2. Translation Quality

| Dimension | Realtime API | Cascade |
|-----------|-------------|---------|
| EN→ES BLEU-4 (medical domain) | 0.67 | **0.71** |
| EN→ES chrF (medical domain) | 0.73 | **0.76** |
| EN→ES Fluency (LLM judge, 1–5) | 4.1 | **4.4** |
| Domain terminology accuracy | Good | **Excellent** |
| Handling of proper nouns / numbers | Inconsistent | Consistent |
| Speaker style preservation | Natural | Slightly formal |

**Observation:** The cascade pipeline produces higher-quality translations in every measured dimension, particularly on medical and legal domain terminology. This is expected: Claude claude-haiku-4-5 is explicitly prompted with domain context and instructed to preserve sentence boundaries and terminology. The Realtime API's model (gpt-4o-realtime) is optimised for conversational naturalness, not domain-accurate interpretation.

The gap is most pronounced on clinical vocabulary. "Myocardial infarction" was correctly preserved in every cascade turn; the Realtime model occasionally paraphrased it as "heart attack" — technically correct but not appropriate for a clinical interpretation context.

**Note:** Quality measurements are subjective and context-dependent. The cascade pipeline's quality advantage may narrow as OpenAI improves the Realtime model's instruction-following.

---

## 3. Cost per Minute

_Estimates based on published API pricing as of May 2026. 150 words/minute average speaking rate._

| Cost component | Realtime API | Cascade |
|----------------|-------------|---------|
| STT | Included | Deepgram: ~$0.0043/min |
| Translation/LLM | Included | Claude Haiku: ~$0.0022/min |
| TTS | Included | OpenAI TTS-1: ~$0.0150/min |
| **Total (estimated)** | **~$0.06/min** | **~$0.022/min** |
| Pricing model | Flat per minute | Per-token + per-character |

**Observation:** Cascade is approximately 3× cheaper per interpreted minute at current pricing. The Realtime API's flat per-minute pricing is simpler to reason about but costs more at typical conversation densities.

The cascade pipeline's cost is dominated by TTS (~68% of total). Switching to a lower-cost TTS provider (e.g., Azure Speech at ~$0.004/min) would bring cascade cost to ~$0.009/min — over 6× cheaper than Realtime.

**Important caveat:** These are pre-production estimates. Actual costs depend on silence handling (both modes bill for silence differently), error rates (failed turns that are retried), and volume discounts.

---

## 4. Controllability

| Dimension | Realtime API | Cascade |
|-----------|-------------|---------|
| Domain-specific system prompts | ✅ Via session.update | ✅ Per-provider prompts |
| Provider swappability | ❌ Locked to OpenAI | ✅ Any STT/Translation/TTS |
| Per-stage observability | ❌ Black box | ✅ Full latency breakdown |
| Custom terminology / glossaries | Limited | ✅ Via translation prompt |
| Voice selection (TTS) | ✅ Per session | ✅ Per language pair |
| Output format control | ❌ Audio only | ✅ Text + audio |
| Transcript correction / post-processing | ❌ Not possible | ✅ Between STT and Translation |
| Vendor lock-in | High | Low |

**Observation:** The cascade pipeline offers dramatically more operational control. This matters for Boostlingo specifically because:

1. **Uncommon language pairs:** The Realtime API's quality on low-resource language pairs (e.g., EN→Swahili, EN→Hmong) is unproven and cannot be supplemented. The cascade pipeline can route uncommon pairs to a specialist STT provider (e.g., a fine-tuned Whisper model) while keeping the same translation and TTS providers.

2. **Domain customisation:** Medical interpretation has strict terminology requirements. The cascade pipeline can inject a medical glossary into the translation prompt and add a post-processing step that validates critical terms. The Realtime API provides no equivalent hook.

3. **Compliance and data residency:** Some enterprise customers require that audio data not leave specific geographic regions. The cascade pipeline can be configured with regional provider endpoints. The Realtime API data residency is opaque.

---

## 5. Operational Complexity

| Dimension | Realtime API | Cascade |
|-----------|-------------|---------|
| External dependencies | 1 (OpenAI) | 3 (Deepgram, Claude, OpenAI) |
| Moving parts to monitor | 1 WebSocket | 3 API endpoints + pipeline state |
| Failure modes | WS disconnect → full restart | Per-stage errors; partial degradation possible |
| Time to onboard new language pair | Minutes (model already supports it) | Hours (record golden data, configure pair) |
| Time to onboard new provider | N/A | ~1 day (implement interface, add tests) |

**Observation:** The Realtime API is simpler to operate in steady state. It has one dependency, one connection type, and one failure mode. The cascade pipeline has three dependencies, three circuit breakers to configure, and more complex degradation paths.

However, the cascade pipeline degrades more gracefully. If Deepgram has an outage, the pipeline can fall back to Whisper. If Claude has a rate limit spike, it can fall back to GPT-4o-mini. The Realtime API has no such fallback — an OpenAI outage takes the entire service down.

---

## Recommendation

**Use the Realtime API when:**
- Latency is the primary constraint (emergency interpretation, fast-paced conversation)
- The language pair is a major world language supported by OpenAI's model
- The interaction is casual/conversational rather than domain-specific
- Operational simplicity is preferred over flexibility

**Use the Cascade pipeline when:**
- Domain accuracy is critical (medical, legal, technical interpretation)
- Uncommon or low-resource language pairs are required
- Cost per minute is a key metric (3–6× cheaper than Realtime)
- Compliance, data residency, or auditability requirements apply
- Per-stage observability is needed for quality monitoring and vendor evaluation

**Boostlingo-specific recommendation:**

For Boostlingo's core telephony interpretation product (primarily medical and legal), **the cascade pipeline is the better fit at this time** — the quality advantage on domain-specific vocabulary, the cost savings at Boostlingo's scale, and the ability to support uncommon language pairs outweigh the 600 ms latency advantage of the Realtime API.

The Realtime API is worth deploying as a **premium tier** for on-demand interpretation where latency is the differentiator (e.g., live events, real-time captioning). As OpenAI improves the Realtime model's domain accuracy and expands language support, this recommendation should be revisited — likely within 12 months.
