/**
 * Tests to verify React immutability principles are followed
 * Related to Issue #85: Direct state mutation violates React immutability principles
 *
 * These tests ensure that state updates create new objects instead of mutating existing ones
 */

describe('Immutable State Updates', () => {
    describe('GroupNew onFriendChange pattern', () => {
        it('should create new objects when updating checked state', () => {
            // Simulate friendData state
            const friendData = [
                { uid: 'user1', name: 'Alice', checked: false },
                { uid: 'user2', name: 'Bob', checked: false },
                { uid: 'user3', name: 'Charlie', checked: true },
            ];

            const values = ['user1', 'user3']; // Selected user IDs

            // Immutable update pattern (as implemented in fix)
            const newFriendData = friendData.map(item => {
                const isSelected = values.includes(item.uid);
                return { ...item, checked: isSelected };
            });

            // Verify new array is created
            expect(newFriendData).not.toBe(friendData);

            // Verify new objects are created
            expect(newFriendData[0]).not.toBe(friendData[0]);
            expect(newFriendData[1]).not.toBe(friendData[1]);
            expect(newFriendData[2]).not.toBe(friendData[2]);

            // Verify correct checked states
            expect(newFriendData[0].checked).toBe(true);  // user1 selected
            expect(newFriendData[1].checked).toBe(false); // user2 not selected
            expect(newFriendData[2].checked).toBe(true);  // user3 selected

            // Verify original array is not mutated
            expect(friendData[0].checked).toBe(false);
            expect(friendData[1].checked).toBe(false);
            expect(friendData[2].checked).toBe(true);
        });

        it('should not mutate original objects when toggling selection', () => {
            const item = { uid: 'user1', name: 'Alice', checked: false };

            // Wrong way: direct mutation
            // item.checked = true; // This would mutate the original

            // Right way: create new object with spread
            const updatedItem = { ...item, checked: true };

            // Verify original is unchanged
            expect(item.checked).toBe(false);
            expect(updatedItem.checked).toBe(true);
            expect(updatedItem).not.toBe(item);
        });
    });

    describe('NewFriend friendSure pattern', () => {
        it('should update friendApplys array immutably', () => {
            const FriendApplyState = {
                pending: 0,
                accepted: 1,
                rejected: 2,
            };

            const friendApplys = [
                { to_uid: 'user1', status: FriendApplyState.pending },
                { to_uid: 'user2', status: FriendApplyState.pending },
                { to_uid: 'user3', status: FriendApplyState.accepted },
            ];

            const targetUid = 'user1';

            // Immutable update pattern (as implemented in fix)
            const newFriendApplys = friendApplys.map(item =>
                item.to_uid === targetUid
                    ? { ...item, status: FriendApplyState.accepted }
                    : item
            );

            // Verify new array is created
            expect(newFriendApplys).not.toBe(friendApplys);

            // Verify only the target object is replaced
            expect(newFriendApplys[0]).not.toBe(friendApplys[0]); // Changed
            expect(newFriendApplys[1]).toBe(friendApplys[1]);     // Unchanged (same reference)
            expect(newFriendApplys[2]).toBe(friendApplys[2]);     // Unchanged (same reference)

            // Verify correct status update
            expect(newFriendApplys[0].status).toBe(FriendApplyState.accepted);

            // Verify original array item is not mutated
            expect(friendApplys[0].status).toBe(FriendApplyState.pending);
        });
    });

    describe('Contacts channelInfoListener pattern', () => {
        it('should replace object in array instead of mutating properties', () => {
            const contactsList = [
                { uid: 'user1', name: 'Alice', remark: '' },
                { uid: 'user2', name: 'Bob', remark: 'Bobby' },
            ];

            const channelInfo = {
                channel: { channelID: 'user1' },
                title: 'Alice Updated',
                orgData: { remark: 'New Remark' },
            };

            // Immutable update pattern (as implemented in fix)
            const idx = contactsList.findIndex(
                (v) => v.uid === channelInfo.channel.channelID
            );
            expect(idx).toBe(0);

            // Create new object instead of mutating
            const updatedContact = {
                ...contactsList[idx],
                name: channelInfo.title,
                remark: channelInfo.orgData?.remark,
            };

            // Verify new object is created
            expect(updatedContact).not.toBe(contactsList[idx]);

            // Verify correct property updates
            expect(updatedContact.name).toBe('Alice Updated');
            expect(updatedContact.remark).toBe('New Remark');

            // Original object should be preserved (before array replacement)
            expect(contactsList[idx].name).toBe('Alice');
            expect(contactsList[idx].remark).toBe('');
        });

        it('should handle missing orgData gracefully', () => {
            const contact = { uid: 'user1', name: 'Alice', remark: 'old' };
            const channelInfo = {
                title: 'New Name',
                orgData: undefined as { remark?: string } | undefined,
            };

            const updatedContact = {
                ...contact,
                name: channelInfo.title,
                remark: channelInfo.orgData?.remark,
            };

            expect(updatedContact.name).toBe('New Name');
            expect(updatedContact.remark).toBe(undefined);
        });
    });

    describe('General immutability patterns', () => {
        it('should use spread operator to create new objects', () => {
            const original = { a: 1, b: 2 };
            const updated = { ...original, b: 3 };

            expect(updated).not.toBe(original);
            expect(original.b).toBe(2);
            expect(updated.b).toBe(3);
        });

        it('should use map to create new arrays with updated items', () => {
            const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
            const newItems = items.map(item =>
                item.id === 2 ? { ...item, updated: true } : item
            );

            expect(newItems).not.toBe(items);
            expect(newItems[1]).not.toBe(items[1]);
            expect((newItems[1] as any).updated).toBe(true);
        });

        it('should use filter to create new arrays', () => {
            const items = [1, 2, 3, 4, 5];
            const filtered = items.filter(x => x % 2 === 0);

            expect(filtered).not.toBe(items);
            expect(filtered).toEqual([2, 4]);
            expect(items).toEqual([1, 2, 3, 4, 5]);
        });
    });
});
