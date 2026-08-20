const DEFAULT_TIMEOUT_MS = 8_000;

export class SupabaseBillingRepository {
  constructor({ url, serviceKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!url || !serviceKey) {
      throw new Error('Supabase billing repository is not configured');
    }
    this.url = url.replace(/\/$/, '');
    this.serviceKey = serviceKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async claimEvent(event) {
    return this.#rpc('claim_stripe_webhook_event', {
      p_event_id: event.event_id,
      p_event_type: event.event_type,
      p_event_created_at: event.created_at,
      p_object_id: event.object_id,
      p_livemode: event.livemode
    });
  }

  async applyEvent(event) {
    return this.#rpc('apply_stripe_billing_event', { p_event: event });
  }

  async finishEvent(eventId, status, error = null) {
    return this.#rpc('finish_stripe_webhook_event', {
      p_event_id: eventId,
      p_status: status,
      p_error: error
    });
  }

  async claimOutbox() {
    return this.#rpc('claim_stripe_billing_outbox', {});
  }

  async finishOutbox(dedupeKey, status, error = null, result = null) {
    return this.#rpc('finish_stripe_billing_outbox', {
      p_dedupe_key: dedupeKey,
      p_status: status,
      p_error: error,
      p_result: result
    });
  }

  async #rpc(name, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;

    try {
      response = await this.fetchImpl(`${this.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: this.serviceKey,
          Authorization: `Bearer ${this.serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Supabase RPC ${name} timed out`);
      }
      throw new Error(`Supabase RPC ${name} could not be reached`, { cause: error });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.text();
    if (!response.ok) {
      const detail = body.replace(/[\r\n]+/g, ' ').slice(0, 300);
      throw new Error(`Supabase RPC ${name} failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`Supabase RPC ${name} returned invalid JSON`, { cause: error });
    }
  }
}
