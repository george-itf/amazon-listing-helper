/**
 * I.2 FIX: Custom hook for component editing with useReducer
 *
 * Replaces the useState mess with a single reducer and typed actions.
 * Provides clear action semantics: EDIT_START, EDIT_CANCEL, EDIT_SAVE, etc.
 */
import { useReducer, useCallback } from 'react';
import type { Component } from '../api/boms';
import { bulkUpdateComponents } from '../api/boms';

// Types
export interface EditingCell {
  id: number;
  field: keyof Component;
}

// State
export interface ComponentEditorState {
  editedComponents: Map<number, Partial<Component>>;
  editingCell: EditingCell | null;
  hasChanges: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveProgress: number; // I.3: Progress for bulk save (0-100)
}

// Actions
export type ComponentEditorAction =
  | { type: 'EDIT_START'; payload: EditingCell }
  | { type: 'EDIT_CANCEL' }
  | { type: 'EDIT_CELL'; payload: { id: number; field: keyof Component; value: string | number | null } }
  | { type: 'REVERT_CELL'; payload: { id: number; field: keyof Component } }
  | { type: 'DISCARD_ALL' }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_PROGRESS'; payload: number }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_ERROR'; payload: string }
  | { type: 'RESET' };

// Initial state
const initialState: ComponentEditorState = {
  editedComponents: new Map(),
  editingCell: null,
  hasChanges: false,
  isSaving: false,
  saveError: null,
  saveProgress: 0,
};

// Reducer
function componentEditorReducer(
  state: ComponentEditorState,
  action: ComponentEditorAction
): ComponentEditorState {
  switch (action.type) {
    case 'EDIT_START':
      return {
        ...state,
        editingCell: action.payload,
      };

    case 'EDIT_CANCEL':
      return {
        ...state,
        editingCell: null,
      };

    case 'EDIT_CELL': {
      const { id, field, value } = action.payload;
      const newMap = new Map(state.editedComponents);
      const existing = newMap.get(id) || {};
      newMap.set(id, { ...existing, [field]: value });
      return {
        ...state,
        editedComponents: newMap,
        hasChanges: true,
      };
    }

    case 'REVERT_CELL': {
      const { id, field } = action.payload;
      const newMap = new Map(state.editedComponents);
      const existing = newMap.get(id);
      if (existing) {
        const newExisting = { ...existing };
        delete newExisting[field];
        if (Object.keys(newExisting).length === 0) {
          newMap.delete(id);
        } else {
          newMap.set(id, newExisting);
        }
      }
      return {
        ...state,
        editedComponents: newMap,
        editingCell: null,
        hasChanges: newMap.size > 0,
      };
    }

    case 'DISCARD_ALL':
      return {
        ...state,
        editedComponents: new Map(),
        editingCell: null,
        hasChanges: false,
      };

    case 'SAVE_START':
      return {
        ...state,
        isSaving: true,
        saveError: null,
        saveProgress: 0,
      };

    case 'SAVE_PROGRESS':
      return {
        ...state,
        saveProgress: action.payload,
      };

    case 'SAVE_SUCCESS':
      return {
        ...state,
        editedComponents: new Map(),
        editingCell: null,
        hasChanges: false,
        isSaving: false,
        saveProgress: 100,
      };

    case 'SAVE_ERROR':
      return {
        ...state,
        isSaving: false,
        saveError: action.payload,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// Hook
export function useComponentEditor() {
  const [state, dispatch] = useReducer(componentEditorReducer, initialState);

  // Start editing a cell
  const startEdit = useCallback((id: number, field: keyof Component) => {
    dispatch({ type: 'EDIT_START', payload: { id, field } });
  }, []);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    dispatch({ type: 'EDIT_CANCEL' });
  }, []);

  // Update a cell value
  const editCell = useCallback((id: number, field: keyof Component, value: string | number | null) => {
    dispatch({ type: 'EDIT_CELL', payload: { id, field, value } });
  }, []);

  // Revert a specific cell's changes
  const revertCell = useCallback((id: number, field: keyof Component) => {
    dispatch({ type: 'REVERT_CELL', payload: { id, field } });
  }, []);

  // Discard all changes
  const discardAll = useCallback(() => {
    dispatch({ type: 'DISCARD_ALL' });
  }, []);

  // Reset to initial state (e.g., after data reload)
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // Get the current value for a component field (edited or original)
  const getValue = useCallback((component: Component, field: keyof Component): string | number | null => {
    const edited = state.editedComponents.get(component.id);
    if (edited && field in edited) {
      return edited[field] as string | number | null;
    }
    return component[field] as string | number | null;
  }, [state.editedComponents]);

  // Check if a cell has been modified
  const isModified = useCallback((id: number, field: keyof Component): boolean => {
    return state.editedComponents.get(id)?.[field] !== undefined;
  }, [state.editedComponents]);

  // Check if currently editing a specific cell
  const isEditing = useCallback((id: number, field: keyof Component): boolean => {
    return state.editingCell?.id === id && state.editingCell?.field === field;
  }, [state.editingCell]);

  // Save all changes (I.3: with progress tracking)
  // NOTE: BulkUpdateResult.errors has id: number | null per api/boms.ts
  const saveChanges = useCallback(async (): Promise<{ updated: number; failed: number; errors: Array<{ id: number | null; error: string }> }> => {
    if (state.editedComponents.size === 0) {
      return { updated: 0, failed: 0, errors: [] };
    }

    dispatch({ type: 'SAVE_START' });

    try {
      const updates = Array.from(state.editedComponents.entries()).map(([id, changes]) => ({
        id,
        ...changes,
      }));

      // I.3: Simulate progress for better UX
      dispatch({ type: 'SAVE_PROGRESS', payload: 20 });

      const result = await bulkUpdateComponents(updates);

      dispatch({ type: 'SAVE_PROGRESS', payload: 90 });

      if (result.failed > 0) {
        dispatch({ type: 'SAVE_ERROR', payload: `${result.failed} updates failed` });
      } else {
        dispatch({ type: 'SAVE_SUCCESS' });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      dispatch({ type: 'SAVE_ERROR', payload: message });
      throw error;
    }
  }, [state.editedComponents]);

  // Handle keyboard events for editing
  const handleKeyDown = useCallback((e: React.KeyboardEvent, id: number, field: keyof Component) => {
    if (e.key === 'Enter') {
      cancelEdit();
    } else if (e.key === 'Escape') {
      revertCell(id, field);
    }
  }, [cancelEdit, revertCell]);

  return {
    // State
    state,
    editedComponentsCount: state.editedComponents.size,
    hasChanges: state.hasChanges,
    isSaving: state.isSaving,
    saveError: state.saveError,
    saveProgress: state.saveProgress,
    editingCell: state.editingCell,

    // Actions
    startEdit,
    cancelEdit,
    editCell,
    revertCell,
    discardAll,
    reset,
    saveChanges,

    // Helpers
    getValue,
    isModified,
    isEditing,
    handleKeyDown,
  };
}
