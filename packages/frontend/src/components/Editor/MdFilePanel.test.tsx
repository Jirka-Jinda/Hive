import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MdFilePanel from './MdFilePanel';
import { resetAppStore } from '../../test/resetAppStore';
import { useAppStore } from '../../store/appStore';

const apiMock = vi.hoisted(() => ({
	mdfiles: {
		get: vi.fn(),
		update: vi.fn(),
		create: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock('../../api/client', () => ({ api: apiMock }));

describe('MdFilePanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAppStore({
			mdFiles: [
				{
					id: 101,
					scope: 'central',
					repo_id: null,
					session_id: null,
					path: 'notes.md',
					type: 'instruction',
					created_at: '2026-04-27T00:00:00Z',
					updated_at: '2026-04-27T00:00:00Z',
				},
			],
			selectedMdFile: {
				id: 101,
				scope: 'central',
				repo_id: null,
				session_id: null,
				path: 'notes.md',
				type: 'instruction',
				created_at: '2026-04-27T00:00:00Z',
				updated_at: '2026-04-27T00:00:00Z',
				content: '# Notes',
			},
		});

		apiMock.mdfiles.update.mockResolvedValue({
			id: 101,
			scope: 'central',
			repo_id: null,
			session_id: null,
			path: 'renamed-notes.md',
			type: 'instruction',
			created_at: '2026-04-27T00:00:00Z',
			updated_at: '2026-04-27T00:00:01Z',
		});
	});

	it('renames the selected md file inline and updates store state', async () => {
		const user = userEvent.setup();
		render(<MdFilePanel onCollapse={() => undefined} />);

		await user.click(screen.getByTitle('Rename file'));
		const input = screen.getByDisplayValue('notes.md');
		await user.clear(input);
		await user.type(input, 'renamed-notes');
		await user.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => {
			expect(apiMock.mdfiles.update).toHaveBeenCalledWith(101, { filename: 'renamed-notes' });
		});

		expect(useAppStore.getState().mdFiles[0]).toMatchObject({
			id: 101,
			path: 'renamed-notes.md',
		});
		expect(useAppStore.getState().selectedMdFile).toMatchObject({
			id: 101,
			path: 'renamed-notes.md',
			content: '# Notes',
		});
	});
});
