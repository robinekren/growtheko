export async function processBillingOutboxBatch({
  repository,
  deliverJob,
  batchSize = 10,
  logger = console
}) {
  if (!repository || typeof repository.claimOutbox !== 'function') {
    throw new TypeError('Outbox repository is required');
  }
  if (typeof deliverJob !== 'function') {
    throw new TypeError('Outbox delivery function is required');
  }

  const limit = Math.min(20, Math.max(1, Number.parseInt(batchSize, 10) || 10));
  const summary = { claimed: 0, completed: 0, failed: 0, empty: false };

  for (let index = 0; index < limit; index += 1) {
    const claim = await repository.claimOutbox();
    if (!claim?.claimed || !claim.job) {
      summary.empty = true;
      break;
    }

    const job = claim.job;
    summary.claimed += 1;

    try {
      const result = await deliverJob(job);
      await repository.finishOutbox(job.dedupe_key, 'completed', null, result || null);
      summary.completed += 1;
    } catch (error) {
      const message = safeErrorMessage(error);
      try {
        await repository.finishOutbox(job.dedupe_key, 'failed', message, null);
      } catch (finishError) {
        logger.error?.(`[BILLING OUTBOX] Could not mark ${job.dedupe_key} failed`, finishError);
        throw finishError;
      }
      logger.error?.(`[BILLING OUTBOX] ${job.dedupe_key} failed: ${message}`);
      summary.failed += 1;
    }
  }

  return summary;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

