/**
 * Settings Page
 *
 * Manage application settings including business rules, guardrails,
 * sync configuration, and publishing options.
 */

import { useState, useEffect } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import { OperatorHealthPanel } from '../components/OperatorHealthPanel';
import {
  getSettings,
  updateSettings,
  getSettingsByCategory,
  CATEGORY_LABELS,
  type Settings,
  type SettingDefinition,
} from '../api/settings';

// Convert percentage values (0-1) to display values (0-100) and back
function toDisplayValue(value: unknown, def: SettingDefinition): unknown {
  if (def.type === 'percentage' && typeof value === 'number') {
    return Math.round(value * 100);
  }
  return value;
}

function toStorageValue(value: unknown, def: SettingDefinition): unknown {
  if (def.type === 'percentage' && typeof value === 'number') {
    return value / 100;
  }
  return value;
}

// Get default value for a setting type
function getDefaultValue(def: SettingDefinition): unknown {
  switch (def.type) {
    case 'number':
    case 'percentage':
      return def.min ?? 0;
    case 'boolean':
      return false;
    case 'string':
      return def.enum?.[0] ?? '';
    default:
      return '';
  }
}

// Input component for different setting types
function SettingInput({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: SettingDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const displayValue = toDisplayValue(value, definition);

  if (definition.type === 'boolean') {
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(displayValue)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
        <span className="ms-3 text-sm font-medium text-gray-700">
          {displayValue ? 'Enabled' : 'Disabled'}
        </span>
      </label>
    );
  }

  if (definition.type === 'string' && definition.enum) {
    return (
      <select
        value={String(displayValue)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="block w-full max-w-xs rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-100"
      >
        {definition.enum.map((option) => (
          <option key={option} value={option}>
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </option>
        ))}
      </select>
    );
  }

  if (definition.type === 'number' || definition.type === 'percentage') {
    const min = definition.type === 'percentage' ? 0 : definition.min;
    const max = definition.type === 'percentage' ? 100 : definition.max;

    return (
      <div className="flex items-center gap-3">
        <input
          type="number"
          value={displayValue as number}
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            if (!isNaN(num)) {
              onChange(toStorageValue(num, definition));
            }
          }}
          min={min}
          max={max}
          step={definition.step ?? 1}
          disabled={disabled}
          className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-100"
        />
        {definition.type === 'percentage' && (
          <span className="text-gray-500">%</span>
        )}
        {definition.type === 'number' && definition.key.includes('minutes') && (
          <span className="text-gray-500">minutes</span>
        )}
        {definition.type === 'number' && definition.key.includes('days') && (
          <span className="text-gray-500">days</span>
        )}
        {definition.type === 'number' && definition.key.includes('threshold') && (
          <span className="text-gray-500">units</span>
        )}
      </div>
    );
  }

  return (
    <input
      type="text"
      value={String(displayValue)}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="block w-full max-w-xs rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-100"
    />
  );
}

// Category section component
function SettingsCategory({
  category,
  definitions,
  values,
  pendingChanges,
  onValueChange,
  disabled,
}: {
  category: string;
  definitions: SettingDefinition[];
  values: Record<string, unknown>;
  pendingChanges: Record<string, unknown>;
  onValueChange: (key: string, value: unknown) => void;
  disabled: boolean;
}) {
  const { label, description } = CATEGORY_LABELS[category];

  return (
    <div className="card mb-6">
      <div className="border-b border-gray-200 pb-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>

      <div className="space-y-6">
        {definitions.map((def) => {
          const currentValue = pendingChanges[def.key] ?? values[def.key] ?? getDefaultValue(def);
          const hasChange = def.key in pendingChanges;

          return (
            <div key={def.key} className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-gray-700">
                  {def.label}
                  {hasChange && (
                    <span className="ml-2 text-xs text-orange-600 font-normal">
                      (modified)
                    </span>
                  )}
                </label>
                <p className="text-xs text-gray-500 mt-1">{def.description}</p>
              </div>
              <div className="sm:w-48 flex-shrink-0">
                <SettingInput
                  definition={def}
                  value={currentValue}
                  onChange={(value) => onValueChange(def.key, value)}
                  disabled={disabled}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadSettings = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getSettings();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Extract raw values from settings
  const values: Record<string, unknown> = {};
  for (const [key, setting] of Object.entries(settings)) {
    values[key] = setting.value;
  }

  const handleValueChange = (key: string, value: unknown) => {
    setPendingChanges((prev) => ({
      ...prev,
      [key]: value,
    }));
    setSuccessMessage(null);
  };

  const handleSave = async () => {
    if (Object.keys(pendingChanges).length === 0) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await updateSettings(pendingChanges);
      // Merge changes into settings
      const updatedSettings = { ...settings };
      for (const [key, value] of Object.entries(pendingChanges)) {
        updatedSettings[key] = {
          value,
          description: settings[key]?.description ?? null,
        };
      }
      setSettings(updatedSettings);
      setPendingChanges({});
      setSuccessMessage(`Saved ${Object.keys(pendingChanges).length} setting(s) successfully`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPendingChanges({});
    setSuccessMessage(null);
  };

  const settingsByCategory = getSettingsByCategory();
  const hasChanges = Object.keys(pendingChanges).length > 0;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure business rules, guardrails, and system behavior"
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={!hasChanges || isSaving}
              className="btn btn-secondary btn-sm disabled:opacity-50"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="btn btn-primary btn-sm disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Saving...
                </>
              ) : (
                <>
                  Save Changes
                  {hasChanges && (
                    <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">
                      {Object.keys(pendingChanges).length}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
        }
      />

      {/* Success Message */}
      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-lg flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {successMessage}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
          <button onClick={loadSettings} className="ml-auto text-sm underline">
            Retry
          </button>
        </div>
      )}

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="mb-6 p-4 bg-orange-50 text-orange-700 rounded-lg flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          You have unsaved changes. Click "Save Changes" to apply them.
        </div>
      )}

      {/* Operator Health Panel */}
      <OperatorHealthPanel />

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12 text-gray-500">
          Loading settings...
        </div>
      )}

      {/* Settings Form */}
      {!isLoading && (
        <div>
          {/* Margins & Pricing */}
          <SettingsCategory
            category="margins"
            definitions={settingsByCategory.margins}
            values={values}
            pendingChanges={pendingChanges}
            onValueChange={handleValueChange}
            disabled={isSaving}
          />

          {/* Guardrails */}
          <SettingsCategory
            category="guardrails"
            definitions={settingsByCategory.guardrails}
            values={values}
            pendingChanges={pendingChanges}
            onValueChange={handleValueChange}
            disabled={isSaving}
          />

          {/* Data Sync */}
          <SettingsCategory
            category="sync"
            definitions={settingsByCategory.sync}
            values={values}
            pendingChanges={pendingChanges}
            onValueChange={handleValueChange}
            disabled={isSaving}
          />

          {/* Publishing */}
          <SettingsCategory
            category="publish"
            definitions={settingsByCategory.publish}
            values={values}
            pendingChanges={pendingChanges}
            onValueChange={handleValueChange}
            disabled={isSaving}
          />

          {/* Bottom Save Button */}
          {hasChanges && (
            <div className="sticky bottom-4 flex justify-end gap-2 p-4 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200">
              <button
                onClick={handleReset}
                disabled={isSaving}
                className="btn btn-secondary"
              >
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="btn btn-primary inline-flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    Saving...
                  </>
                ) : (
                  `Save ${Object.keys(pendingChanges).length} Change(s)`
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
