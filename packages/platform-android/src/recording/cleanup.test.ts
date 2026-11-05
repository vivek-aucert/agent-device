import { expect, test } from 'vitest';
import { cleanupVerifiedAndroidEvidence } from './cleanup.ts';
import { androidRecordingDevice, recordingHost, recordingInput } from './fixtures.ts';
import { createNativeManifest, type NativeManifest } from './manifest.ts';

const recordedChunk = {
  index: 1,
  remotePath: '/sdcard/agent-device-recording-1.mp4',
  remotePid: '42',
  remoteStartTime: '7',
};

function reusedPidEvidence(): NativeManifest {
  return createNativeManifest(
    androidRecordingDevice,
    recordingInput(),
    1,
    [recordedChunk],
    undefined,
    'local',
  );
}

test('attempts every fenced native chunk before retaining cleanup evidence', async () => {
  const attempts: string[] = [];
  const host = recordingHost({
    stop: async ({ pid }: { pid: string }) => {
      attempts.push(`stop:${pid}`);
      if (pid === '41') throw new Error('stop failed');
      return 'stopped' as const;
    },
    inspect: async () => 'missing' as const,
    remove: async (remotePath: string) => {
      attempts.push(`remove:${remotePath}`);
      return true;
    },
  });
  const transport = await host.screenRecording.android.resolve(androidRecordingDevice);
  const evidence = createNativeManifest(
    androidRecordingDevice,
    recordingInput(),
    1,
    [
      {
        index: 1,
        remotePath: '/sdcard/agent-device-recording-1.mp4',
        remotePid: '41',
        remoteStartTime: '7',
      },
      {
        index: 2,
        remotePath: '/sdcard/agent-device-recording-2.mp4',
        remotePid: '42',
        remoteStartTime: '8',
      },
    ],
    undefined,
    'local',
  );
  await expect(
    cleanupVerifiedAndroidEvidence(
      transport,
      evidence,
      '/sdcard/agent-device-recording-active.json',
    ),
  ).resolves.toMatchObject({ status: 'cleanup-pending' });
  expect(attempts).toContain('stop:42');
  expect(attempts).toContain('stop:41');
});

test('cleans evidence whose pid was reassigned once a conclusive scan finds no writer', async () => {
  const stops: Array<{ pid: string; force?: boolean }> = [];
  const removed: string[] = [];
  const markers: string[] = [];
  const host = recordingHost({
    stop: async (
      { pid }: { pid: string },
      options?: Readonly<{ force?: boolean }>,
    ): Promise<'ownership-lost'> => {
      stops.push({ pid, force: options?.force });
      return 'ownership-lost';
    },
    findRunning: async () => ({ writers: [], conclusive: true }),
    remove: async (remotePath: string) => {
      removed.push(remotePath);
      return true;
    },
    removeManifest: async (manifestPath: string) => {
      markers.push(manifestPath);
      return true;
    },
  });
  const transport = await host.screenRecording.android.resolve(androidRecordingDevice);
  await expect(
    cleanupVerifiedAndroidEvidence(
      transport,
      reusedPidEvidence(),
      '/sdcard/agent-device-recording-active.json',
    ),
  ).resolves.toEqual({ status: 'cleaned' });
  expect(stops).toEqual([{ pid: '42', force: undefined }]);
  expect(removed).toEqual([recordedChunk.remotePath]);
  expect(markers).toEqual(['/sdcard/agent-device-recording-active.json']);
});

test('cleans evidence whose pid is reassigned while its graceful stop is polled', async () => {
  const stops: Array<{ pid: string; force?: boolean }> = [];
  const host = recordingHost({
    stop: async (
      { pid }: { pid: string },
      options?: Readonly<{ force?: boolean }>,
    ): Promise<'stopped'> => {
      stops.push({ pid, force: options?.force });
      return 'stopped';
    },
    inspect: async () => 'ownership-lost' as const,
    findRunning: async () => ({ writers: [], conclusive: true }),
    removeManifest: async () => true,
  });
  const transport = await host.screenRecording.android.resolve(androidRecordingDevice);
  await expect(
    cleanupVerifiedAndroidEvidence(
      transport,
      reusedPidEvidence(),
      '/sdcard/agent-device-recording-active.json',
    ),
  ).resolves.toEqual({ status: 'cleaned' });
  expect(stops).toEqual([{ pid: '42', force: undefined }]);
});

test.each([
  ['an inconclusive scan', { writers: [], conclusive: false }],
  [
    'a foreign writer on the recorded path',
    {
      writers: [{ pid: '77', remotePath: recordedChunk.remotePath, startTime: '99' }],
      conclusive: true,
    },
  ],
] as const)('retains evidence whose reassigned pid path reports %s', async (_name, scan) => {
  const removed: string[] = [];
  let manifest = JSON.stringify(reusedPidEvidence());
  const host = recordingHost({
    stop: async () => 'ownership-lost' as const,
    findRunning: async () => scan,
    remove: async (remotePath: string) => {
      removed.push(remotePath);
      return true;
    },
    removeManifest: async () => {
      manifest = '';
      return true;
    },
  });
  const transport = await host.screenRecording.android.resolve(androidRecordingDevice);
  await expect(
    cleanupVerifiedAndroidEvidence(
      transport,
      reusedPidEvidence(),
      '/sdcard/agent-device-recording-active.json',
    ),
  ).resolves.toMatchObject({ status: 'cleanup-pending', reason: 'transport-failed' });
  expect(removed).toEqual([]);
  expect(manifest).not.toBe('');
});

test('stops a recorder that still owns its pid without scanning the artifact path', async () => {
  const stops: Array<{ pid: string; force?: boolean }> = [];
  let scans = 0;
  const host = recordingHost({
    stop: async (
      { pid }: { pid: string },
      options?: Readonly<{ force?: boolean }>,
    ): Promise<'stopped'> => {
      stops.push({ pid, force: options?.force });
      return 'stopped';
    },
    inspect: async () => 'missing' as const,
    findRunning: async () => {
      scans += 1;
      return { writers: [], conclusive: true };
    },
  });
  const transport = await host.screenRecording.android.resolve(androidRecordingDevice);
  await expect(
    cleanupVerifiedAndroidEvidence(
      transport,
      reusedPidEvidence(),
      '/sdcard/agent-device-recording-active.json',
    ),
  ).resolves.toEqual({ status: 'cleaned' });
  expect(stops).toEqual([{ pid: '42', force: undefined }]);
  expect(scans).toBe(0);
});
