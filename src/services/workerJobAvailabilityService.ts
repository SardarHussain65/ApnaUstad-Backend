export type WorkerJobType = 'instant' | 'scheduled';

export const getWorkerJobAvailabilityField = (jobType: WorkerJobType) =>
    jobType === 'instant' ? 'isInstantAvailable' : 'isScheduledAvailable';

/**
 * Missing type-specific values are treated as enabled for existing worker records.
 * Once a worker changes a toggle, both values are persisted explicitly.
 */
export const workerAcceptsJobType = (worker: any, jobType: WorkerJobType) => {
    if (!worker || worker.isActive === false || worker.isAvailable === false) return false;
    return worker[getWorkerJobAvailabilityField(jobType)] !== false;
};

export const buildAvailableWorkerFilterForJobType = (jobType: WorkerJobType) => ({
    isAvailable: true,
    isActive: true,
    [getWorkerJobAvailabilityField(jobType)]: { $ne: false },
});

export const getEnabledJobTypesForWorker = (worker: any): WorkerJobType[] => {
    if (!worker || worker.isActive === false || worker.isAvailable === false) return [];

    const enabledTypes: WorkerJobType[] = [];
    if (worker.isInstantAvailable !== false) enabledTypes.push('instant');
    if (worker.isScheduledAvailable !== false) enabledTypes.push('scheduled');
    return enabledTypes;
};
