# Automation & Rules Engine Architecture

## Overview

The automation engine enables rule-based actions that run automatically based on triggers, conditions, and configurable actions. It supports threshold-based rules, competitive triggers, time-based scheduling, and event-driven automation.

---

## 1. Rules Engine Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           AUTOMATION ENGINE                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         TRIGGER SYSTEM                                   │    │
│  │                                                                          │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │    │
│  │   │  Threshold  │  │ Competitive │  │  Time-Based │  │    Event    │   │    │
│  │   │  Triggers   │  │  Triggers   │  │  Triggers   │  │  Triggers   │   │    │
│  │   │             │  │             │  │             │  │             │   │    │
│  │   │ • Score     │  │ • Price ∆   │  │ • Cron      │  │ • Sync      │   │    │
│  │   │ • Margin    │  │ • BSR ∆     │  │ • Scheduled │  │ • Alert     │   │    │
│  │   │ • Stock     │  │ • New entry │  │ • Seasonal  │  │ • Score     │   │    │
│  │   │ • Buy Box   │  │ • Out stock │  │ • Recurring │  │ • Price     │   │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │    │
│  │                                                                          │    │
│  └────────────────────────────────┬─────────────────────────────────────────┘    │
│                                   │                                              │
│                                   ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        CONDITION EVALUATOR                               │    │
│  │                                                                          │    │
│  │   Rule Scope    →   Field Conditions    →   Logical Operators           │    │
│  │   (All/Category/    (equals, gt, lt,        (AND, OR, NOT)              │    │
│  │    Tag/Listing)      in, contains)                                       │    │
│  │                                                                          │    │
│  └────────────────────────────────┬─────────────────────────────────────────┘    │
│                                   │                                              │
│                                   ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         ACTION EXECUTOR                                  │    │
│  │                                                                          │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │    │
│  │   │   Create    │  │   Update    │  │    Send     │  │    Apply    │   │    │
│  │   │    Task     │  │   Price     │  │   Alert     │  │  Template   │   │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │    │
│  │                                                                          │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │    │
│  │   │    Tag      │  │   Change    │  │   Adjust    │  │   Custom    │   │    │
│  │   │  Listing    │  │  Lifecycle  │  │   Score     │  │  Webhook    │   │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        EXECUTION CONTROLS                                │    │
│  │                                                                          │    │
│  │   • Cooldown periods      • Max daily triggers    • Priority ordering   │    │
│  │   • Conflict resolution   • Rollback capability   • Audit logging       │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Rule Definition

### 2.1 Rule Schema

```typescript
// src/automation/types.ts

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  priority: number;  // Higher = evaluated first

  // Trigger definition
  trigger: RuleTrigger;

  // Scope - what entities this rule applies to
  scope: RuleScope;

  // Conditions that must be met (AND logic by default)
  conditions: RuleCondition[];

  // Actions to execute when triggered
  actions: RuleAction[];

  // Execution controls
  controls: ExecutionControls;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastTriggeredAt: Date | null;
  triggerCount: number;
}

type RuleTrigger =
  | ThresholdTrigger
  | CompetitiveTrigger
  | TimeTrigger
  | EventTrigger;

interface ThresholdTrigger {
  type: 'threshold';
  metric: string;           // 'score', 'margin', 'stock', 'buyBoxPct', 'bsr'
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'change';
  value: number;
  changeDirection?: 'increase' | 'decrease' | 'any';
  changeThreshold?: number; // For 'change' operator
}

interface CompetitiveTrigger {
  type: 'competitive';
  event:
    | 'competitor_price_change'
    | 'competitor_undercut'
    | 'competitor_out_of_stock'
    | 'competitor_back_in_stock'
    | 'new_competitor'
    | 'competitor_listing_change'
    | 'buy_box_lost'
    | 'buy_box_won';
  threshold?: number;       // e.g., price change > 5%
  competitorFilter?: {
    threatScoreMin?: number;
    trackingPriority?: string[];
  };
}

interface TimeTrigger {
  type: 'time';
  schedule: string;         // Cron expression
  timezone?: string;        // Default: Europe/London
}

interface EventTrigger {
  type: 'event';
  eventType: string;        // 'listing.synced', 'listing.scored', 'price.changed', etc.
  filter?: Record<string, unknown>;
}
```

### 2.2 Conditions

```typescript
interface RuleCondition {
  field: string;            // Dot notation: 'listing.category', 'price.margin'
  operator: ConditionOperator;
  value: ConditionValue;
  negate?: boolean;         // NOT operator
}

type ConditionOperator =
  | 'eq'           // Equals
  | 'neq'          // Not equals
  | 'gt'           // Greater than
  | 'gte'          // Greater than or equal
  | 'lt'           // Less than
  | 'lte'          // Less than or equal
  | 'in'           // In array
  | 'notIn'        // Not in array
  | 'contains'     // String contains
  | 'startsWith'   // String starts with
  | 'endsWith'     // String ends with
  | 'matches'      // Regex match
  | 'exists'       // Field exists
  | 'isEmpty';     // Field is empty/null

type ConditionValue = string | number | boolean | string[] | number[];

// Examples:
const conditions: RuleCondition[] = [
  { field: 'listing.customCategory', operator: 'in', value: ['power_tools', 'drills'] },
  { field: 'listing.lifecycleStage', operator: 'eq', value: 'growth' },
  { field: 'price.marginPct', operator: 'gte', value: 15 },
  { field: 'listing.tags', operator: 'contains', value: 'priority' },
];
```

### 2.3 Actions

```typescript
type RuleAction =
  | CreateTaskAction
  | UpdatePriceAction
  | SendAlertAction
  | ApplyTemplateAction
  | TagListingAction
  | ChangeLifecycleAction
  | WebhookAction;

interface CreateTaskAction {
  type: 'create_task';
  config: {
    taskType: TaskType;
    titleTemplate: string;      // Supports {{variables}}
    descriptionTemplate?: string;
    priority?: 'high' | 'medium' | 'low';
    dueInDays?: number;
    assignTo?: string;
  };
}

interface UpdatePriceAction {
  type: 'update_price';
  config: {
    adjustmentType: 'absolute' | 'percentage' | 'match_competitor' | 'beat_competitor';
    value?: number;             // For absolute/percentage
    competitorRef?: string;     // For match/beat
    beatByAmount?: number;
    beatByPercent?: number;
    respectMarginFloor: boolean;
    requireApproval: boolean;   // If true, creates task instead of auto-applying
  };
}

interface SendAlertAction {
  type: 'send_alert';
  config: {
    severity: 'critical' | 'high' | 'medium' | 'low';
    titleTemplate: string;
    messageTemplate: string;
    channels?: ('in_app' | 'email' | 'webhook')[];
  };
}

interface ApplyTemplateAction {
  type: 'apply_template';
  config: {
    templateId: string;
    fields?: string[];          // Specific fields to apply, or all if empty
    requireApproval: boolean;
  };
}

interface TagListingAction {
  type: 'tag_listing';
  config: {
    addTags?: string[];
    removeTags?: string[];
  };
}

interface ChangeLifecycleAction {
  type: 'change_lifecycle';
  config: {
    newStage: LifecycleStage;
    reason?: string;
  };
}

interface WebhookAction {
  type: 'webhook';
  config: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    bodyTemplate?: string;      // JSON template with {{variables}}
  };
}
```

### 2.4 Execution Controls

```typescript
interface ExecutionControls {
  // Cooldown - minimum time between triggers for same entity
  cooldownMinutes: number;

  // Maximum triggers per day (null = unlimited)
  maxDailyTriggers: number | null;

  // Conflict resolution with other rules
  conflictBehavior: 'skip' | 'queue' | 'override';

  // Execution mode
  mode: 'auto' | 'approval_required' | 'dry_run';

  // Rollback settings
  enableRollback: boolean;
  rollbackWindowHours?: number;

  // Notification on trigger
  notifyOnTrigger: boolean;
}
```

---

## 3. Rule Engine Implementation

### 3.1 Rule Engine Core

```typescript
// src/automation/engine.ts

class AutomationEngine {
  private rules: Map<string, AutomationRule> = new Map();
  private triggerHandlers: Map<string, TriggerHandler> = new Map();
  private actionExecutors: Map<string, ActionExecutor> = new Map();
  private cooldownTracker: CooldownTracker;
  private eventBus: EventBus;
  private scheduler: Scheduler;

  constructor(deps: AutomationEngineDeps) {
    this.eventBus = deps.eventBus;
    this.scheduler = deps.scheduler;
    this.cooldownTracker = new CooldownTracker(deps.redis);

    // Register trigger handlers
    this.registerTriggerHandler('threshold', new ThresholdTriggerHandler());
    this.registerTriggerHandler('competitive', new CompetitiveTriggerHandler());
    this.registerTriggerHandler('time', new TimeTriggerHandler(this.scheduler));
    this.registerTriggerHandler('event', new EventTriggerHandler(this.eventBus));

    // Register action executors
    this.registerActionExecutor('create_task', new CreateTaskExecutor(deps.taskService));
    this.registerActionExecutor('update_price', new UpdatePriceExecutor(deps.pricingService));
    this.registerActionExecutor('send_alert', new SendAlertExecutor(deps.alertService));
    this.registerActionExecutor('apply_template', new ApplyTemplateExecutor(deps.templateService));
    this.registerActionExecutor('tag_listing', new TagListingExecutor(deps.listingService));
    this.registerActionExecutor('change_lifecycle', new ChangeLifecycleExecutor(deps.listingService));
    this.registerActionExecutor('webhook', new WebhookExecutor());
  }

  async loadRules(): Promise<void> {
    const rules = await this.ruleRepository.getActiveRules();

    for (const rule of rules) {
      this.rules.set(rule.id, rule);

      // Set up triggers
      const handler = this.triggerHandlers.get(rule.trigger.type);
      if (handler) {
        await handler.register(rule, this.handleTrigger.bind(this));
      }
    }

    logger.info('Automation engine loaded', { ruleCount: rules.length });
  }

  async handleTrigger(
    rule: AutomationRule,
    context: TriggerContext
  ): Promise<void> {
    const executionId = generateId();

    logger.info('Rule triggered', {
      executionId,
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: rule.trigger.type,
      context,
    });

    try {
      // Check cooldown
      const inCooldown = await this.cooldownTracker.isInCooldown(
        rule.id,
        context.entityId
      );

      if (inCooldown) {
        logger.debug('Rule skipped - in cooldown', { ruleId: rule.id });
        return;
      }

      // Check daily limit
      if (rule.controls.maxDailyTriggers) {
        const todayCount = await this.getTodayTriggerCount(rule.id);
        if (todayCount >= rule.controls.maxDailyTriggers) {
          logger.debug('Rule skipped - daily limit reached', { ruleId: rule.id });
          return;
        }
      }

      // Get entities in scope
      const entities = await this.getEntitiesInScope(rule.scope, context);

      // Evaluate conditions for each entity
      const matchingEntities = await this.evaluateConditions(
        entities,
        rule.conditions,
        context
      );

      if (matchingEntities.length === 0) {
        logger.debug('No entities matched conditions', { ruleId: rule.id });
        return;
      }

      // Execute actions
      for (const entity of matchingEntities) {
        await this.executeActions(rule, entity, context, executionId);
      }

      // Update cooldown
      for (const entity of matchingEntities) {
        await this.cooldownTracker.setCooldown(
          rule.id,
          entity.id,
          rule.controls.cooldownMinutes
        );
      }

      // Update trigger count
      await this.incrementTriggerCount(rule.id);

      // Record execution
      await this.recordExecution(executionId, rule, matchingEntities, context);

    } catch (error) {
      logger.error('Rule execution failed', {
        executionId,
        ruleId: rule.id,
        error: (error as Error).message,
      });

      await this.recordExecutionFailure(executionId, rule, error as Error);
    }
  }

  private async evaluateConditions(
    entities: Entity[],
    conditions: RuleCondition[],
    context: TriggerContext
  ): Promise<Entity[]> {
    const results: Entity[] = [];

    for (const entity of entities) {
      const matches = await this.conditionEvaluator.evaluate(
        entity,
        conditions,
        context
      );

      if (matches) {
        results.push(entity);
      }
    }

    return results;
  }

  private async executeActions(
    rule: AutomationRule,
    entity: Entity,
    context: TriggerContext,
    executionId: string
  ): Promise<void> {
    for (const action of rule.actions) {
      const executor = this.actionExecutors.get(action.type);

      if (!executor) {
        logger.error('Unknown action type', { actionType: action.type });
        continue;
      }

      // Check if approval required
      if (rule.controls.mode === 'approval_required') {
        await this.createApprovalTask(rule, action, entity, executionId);
        continue;
      }

      // Dry run - log but don't execute
      if (rule.controls.mode === 'dry_run') {
        logger.info('Dry run - action would execute', {
          executionId,
          action: action.type,
          entityId: entity.id,
        });
        continue;
      }

      // Execute the action
      try {
        const result = await executor.execute(action, entity, context);

        // Log action result
        await this.recordActionResult(executionId, action, entity, result);

        // Store for potential rollback
        if (rule.controls.enableRollback) {
          await this.storeRollbackData(executionId, action, entity, result);
        }
      } catch (error) {
        logger.error('Action execution failed', {
          executionId,
          action: action.type,
          entityId: entity.id,
          error: (error as Error).message,
        });
      }
    }
  }
}
```

### 3.2 Condition Evaluator

```typescript
// src/automation/conditions.ts

class ConditionEvaluator {
  async evaluate(
    entity: Entity,
    conditions: RuleCondition[],
    context: TriggerContext
  ): Promise<boolean> {
    for (const condition of conditions) {
      const matches = await this.evaluateCondition(entity, condition, context);

      // Apply negation
      const result = condition.negate ? !matches : matches;

      // AND logic - all conditions must match
      if (!result) {
        return false;
      }
    }

    return true;
  }

  private async evaluateCondition(
    entity: Entity,
    condition: RuleCondition,
    context: TriggerContext
  ): Promise<boolean> {
    // Get the field value using dot notation
    const fieldValue = this.getFieldValue(entity, condition.field, context);

    // Handle special case: field doesn't exist
    if (fieldValue === undefined) {
      if (condition.operator === 'exists') {
        return false;
      }
      if (condition.operator === 'isEmpty') {
        return true;
      }
      return false;
    }

    // Evaluate based on operator
    switch (condition.operator) {
      case 'eq':
        return fieldValue === condition.value;

      case 'neq':
        return fieldValue !== condition.value;

      case 'gt':
        return Number(fieldValue) > Number(condition.value);

      case 'gte':
        return Number(fieldValue) >= Number(condition.value);

      case 'lt':
        return Number(fieldValue) < Number(condition.value);

      case 'lte':
        return Number(fieldValue) <= Number(condition.value);

      case 'in':
        return (condition.value as unknown[]).includes(fieldValue);

      case 'notIn':
        return !(condition.value as unknown[]).includes(fieldValue);

      case 'contains':
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(condition.value);
        }
        return String(fieldValue).includes(String(condition.value));

      case 'startsWith':
        return String(fieldValue).startsWith(String(condition.value));

      case 'endsWith':
        return String(fieldValue).endsWith(String(condition.value));

      case 'matches':
        return new RegExp(String(condition.value)).test(String(fieldValue));

      case 'exists':
        return true;  // We already checked undefined above

      case 'isEmpty':
        if (Array.isArray(fieldValue)) return fieldValue.length === 0;
        if (typeof fieldValue === 'string') return fieldValue.trim() === '';
        return fieldValue === null;

      default:
        logger.warn('Unknown condition operator', { operator: condition.operator });
        return false;
    }
  }

  private getFieldValue(
    entity: Entity,
    field: string,
    context: TriggerContext
  ): unknown {
    // Support context variables
    if (field.startsWith('context.')) {
      return this.getNestedValue(context, field.substring(8));
    }

    // Support entity fields
    return this.getNestedValue(entity, field);
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      if (current === null || current === undefined) return undefined;
      return (current as Record<string, unknown>)[key];
    }, obj);
  }
}
```

### 3.3 Trigger Handlers

```typescript
// src/automation/triggers/threshold.trigger.ts

class ThresholdTriggerHandler implements TriggerHandler {
  async register(
    rule: AutomationRule,
    callback: TriggerCallback
  ): Promise<void> {
    const trigger = rule.trigger as ThresholdTrigger;

    // Register for relevant events based on metric
    const eventType = this.getEventTypeForMetric(trigger.metric);

    eventBus.on(eventType, async (event) => {
      if (this.shouldTrigger(trigger, event)) {
        await callback(rule, {
          entityId: event.entityId,
          entityType: 'listing',
          triggerData: {
            metric: trigger.metric,
            currentValue: event.currentValue,
            previousValue: event.previousValue,
          },
        });
      }
    });
  }

  private shouldTrigger(trigger: ThresholdTrigger, event: MetricEvent): boolean {
    const { operator, value, changeDirection, changeThreshold } = trigger;
    const { currentValue, previousValue } = event;

    if (operator === 'change') {
      // Check for change amount/direction
      const change = currentValue - (previousValue || 0);

      if (changeDirection === 'increase' && change <= 0) return false;
      if (changeDirection === 'decrease' && change >= 0) return false;

      return Math.abs(change) >= (changeThreshold || 0);
    }

    // Standard comparison
    switch (operator) {
      case 'lt': return currentValue < value;
      case 'lte': return currentValue <= value;
      case 'gt': return currentValue > value;
      case 'gte': return currentValue >= value;
      case 'eq': return currentValue === value;
      default: return false;
    }
  }

  private getEventTypeForMetric(metric: string): string {
    const eventMap: Record<string, string> = {
      score: 'listing.scored',
      margin: 'price.marginCalculated',
      stock: 'inventory.updated',
      buyBoxPct: 'buybox.changed',
      bsr: 'bsr.changed',
      price: 'price.changed',
    };

    return eventMap[metric] || `${metric}.changed`;
  }
}

// src/automation/triggers/competitive.trigger.ts

class CompetitiveTriggerHandler implements TriggerHandler {
  async register(
    rule: AutomationRule,
    callback: TriggerCallback
  ): Promise<void> {
    const trigger = rule.trigger as CompetitiveTrigger;

    eventBus.on('competitor.*', async (event) => {
      if (this.matchesEvent(trigger, event)) {
        // Check competitor filter
        if (trigger.competitorFilter) {
          const competitor = await competitorService.getById(event.competitorId);

          if (trigger.competitorFilter.threatScoreMin &&
              competitor.threatScore < trigger.competitorFilter.threatScoreMin) {
            return;
          }

          if (trigger.competitorFilter.trackingPriority &&
              !trigger.competitorFilter.trackingPriority.includes(competitor.trackingPriority)) {
            return;
          }
        }

        // Check threshold
        if (trigger.threshold && event.changePercent) {
          if (Math.abs(event.changePercent) < trigger.threshold) {
            return;
          }
        }

        await callback(rule, {
          entityId: event.affectedListingId,
          entityType: 'listing',
          triggerData: {
            competitorId: event.competitorId,
            eventType: event.type,
            changePercent: event.changePercent,
          },
        });
      }
    });
  }

  private matchesEvent(trigger: CompetitiveTrigger, event: CompetitorEvent): boolean {
    const eventMap: Record<string, string[]> = {
      competitor_price_change: ['competitor.priceChanged'],
      competitor_undercut: ['competitor.priceChanged'],
      competitor_out_of_stock: ['competitor.outOfStock'],
      competitor_back_in_stock: ['competitor.backInStock'],
      new_competitor: ['competitor.detected'],
      competitor_listing_change: ['competitor.listingChanged'],
      buy_box_lost: ['buybox.lost'],
      buy_box_won: ['buybox.won'],
    };

    const relevantEvents = eventMap[trigger.event] || [];
    return relevantEvents.includes(event.type);
  }
}

// src/automation/triggers/time.trigger.ts

class TimeTriggerHandler implements TriggerHandler {
  private scheduler: Scheduler;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  async register(
    rule: AutomationRule,
    callback: TriggerCallback
  ): Promise<void> {
    const trigger = rule.trigger as TimeTrigger;

    // Register cron job
    await this.scheduler.schedule({
      id: `rule_${rule.id}`,
      cron: trigger.schedule,
      timezone: trigger.timezone || 'Europe/London',
      handler: async () => {
        // For time-based triggers, we trigger for all entities in scope
        await callback(rule, {
          entityId: '*',  // Special marker for "all in scope"
          entityType: 'listing',
          triggerData: {
            scheduledTime: new Date(),
          },
        });
      },
    });
  }

  async unregister(ruleId: string): Promise<void> {
    await this.scheduler.cancel(`rule_${ruleId}`);
  }
}
```

### 3.4 Action Executors

```typescript
// src/automation/actions/createTask.executor.ts

class CreateTaskExecutor implements ActionExecutor {
  private taskService: TaskService;

  constructor(taskService: TaskService) {
    this.taskService = taskService;
  }

  async execute(
    action: CreateTaskAction,
    entity: Entity,
    context: TriggerContext
  ): Promise<ActionResult> {
    const { config } = action;

    // Interpolate templates
    const title = this.interpolate(config.titleTemplate, entity, context);
    const description = config.descriptionTemplate
      ? this.interpolate(config.descriptionTemplate, entity, context)
      : undefined;

    // Calculate due date
    const dueDate = config.dueInDays
      ? addDays(new Date(), config.dueInDays)
      : undefined;

    // Create the task
    const task = await this.taskService.create({
      title,
      description,
      taskType: config.taskType,
      listingId: entity.id,
      priority: config.priority || 'medium',
      dueDate,
      createdBy: 'automation',
      sourceRuleId: context.ruleId,
    });

    return {
      success: true,
      action: 'create_task',
      entityId: entity.id,
      result: { taskId: task.id },
    };
  }

  private interpolate(
    template: string,
    entity: Entity,
    context: TriggerContext
  ): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      // Try entity first
      let value = this.getNestedValue(entity, path);

      // Then context
      if (value === undefined) {
        value = this.getNestedValue(context, path);
      }

      return value !== undefined ? String(value) : match;
    });
  }
}

// src/automation/actions/updatePrice.executor.ts

class UpdatePriceExecutor implements ActionExecutor {
  private pricingService: PricingService;

  async execute(
    action: UpdatePriceAction,
    entity: Entity,
    context: TriggerContext
  ): Promise<ActionResult> {
    const { config } = action;
    const listing = entity as Listing;

    // Get current price
    const currentPrice = await this.pricingService.getCurrentPrice(listing.id);
    let newPrice: number;

    switch (config.adjustmentType) {
      case 'absolute':
        newPrice = config.value!;
        break;

      case 'percentage':
        newPrice = currentPrice.price * (1 + config.value! / 100);
        break;

      case 'match_competitor':
        const competitor = await this.getCompetitorPrice(config.competitorRef!, listing.id);
        newPrice = competitor.price;
        break;

      case 'beat_competitor':
        const competitorPrice = await this.getCompetitorPrice(config.competitorRef!, listing.id);
        if (config.beatByAmount) {
          newPrice = competitorPrice.price - config.beatByAmount;
        } else if (config.beatByPercent) {
          newPrice = competitorPrice.price * (1 - config.beatByPercent / 100);
        } else {
          newPrice = competitorPrice.price - 0.01; // Default: beat by 1p
        }
        break;

      default:
        throw new Error(`Unknown adjustment type: ${config.adjustmentType}`);
    }

    // Check margin floor
    if (config.respectMarginFloor) {
      const marginFloor = await this.getMarginFloor(listing.id);
      const minPrice = await this.pricingService.calculateMinPriceForMargin(
        listing.id,
        marginFloor
      );

      if (newPrice < minPrice) {
        return {
          success: false,
          action: 'update_price',
          entityId: entity.id,
          result: {
            blocked: true,
            reason: `Price £${newPrice.toFixed(2)} would be below margin floor`,
            suggestedPrice: minPrice,
          },
        };
      }
    }

    // Require approval if configured
    if (config.requireApproval) {
      await this.createPriceApprovalTask(listing.id, currentPrice.price, newPrice, context);

      return {
        success: true,
        action: 'update_price',
        entityId: entity.id,
        result: {
          requiresApproval: true,
          proposedPrice: newPrice,
        },
      };
    }

    // Apply the price change
    const previousPrice = currentPrice.price;
    await this.pricingService.updatePrice(listing.id, newPrice);

    return {
      success: true,
      action: 'update_price',
      entityId: entity.id,
      result: {
        previousPrice,
        newPrice,
        changePercent: ((newPrice - previousPrice) / previousPrice) * 100,
      },
      rollbackData: { previousPrice },
    };
  }
}
```

---

## 4. Pre-Built Rule Templates

### 4.1 Common Rule Templates

```typescript
// src/automation/templates/ruleTemplates.ts

export const ruleTemplates: RuleTemplate[] = [
  // === SCORE-BASED RULES ===
  {
    id: 'score_drop_alert',
    name: 'Alert on Score Drop',
    description: 'Create task when listing score drops significantly',
    category: 'scoring',
    defaultConfig: {
      trigger: {
        type: 'threshold',
        metric: 'score',
        operator: 'change',
        changeDirection: 'decrease',
        changeThreshold: 10,
      },
      conditions: [
        { field: 'listing.status', operator: 'eq', value: 'active' },
      ],
      actions: [{
        type: 'create_task',
        config: {
          taskType: 'optimization',
          titleTemplate: 'Score dropped for {{listing.asin}}',
          descriptionTemplate: 'Score dropped from {{triggerData.previousValue}} to {{triggerData.currentValue}}',
          priority: 'high',
          dueInDays: 2,
        },
      }],
      controls: {
        cooldownMinutes: 1440, // Once per day
        mode: 'auto',
      },
    },
  },

  {
    id: 'low_score_review',
    name: 'Review Low-Scoring Listings',
    description: 'Weekly review of listings scoring below threshold',
    category: 'scoring',
    defaultConfig: {
      trigger: {
        type: 'time',
        schedule: '0 9 * * 1', // Every Monday at 9am
      },
      scope: {
        type: 'all',
      },
      conditions: [
        { field: 'listing.currentScore', operator: 'lt', value: 60 },
        { field: 'listing.status', operator: 'eq', value: 'active' },
      ],
      actions: [{
        type: 'create_task',
        config: {
          taskType: 'optimization',
          titleTemplate: 'Weekly review: {{listing.asin}} (Score: {{listing.currentScore}})',
          priority: 'medium',
        },
      }],
    },
  },

  // === COMPETITIVE RULES ===
  {
    id: 'competitor_undercut_response',
    name: 'Respond to Competitor Undercutting',
    description: 'Automatically adjust price when competitor undercuts',
    category: 'competitive',
    defaultConfig: {
      trigger: {
        type: 'competitive',
        event: 'competitor_undercut',
        threshold: 3, // Only trigger if >3% undercut
      },
      conditions: [
        { field: 'price.marginPct', operator: 'gte', value: 20 },
      ],
      actions: [{
        type: 'update_price',
        config: {
          adjustmentType: 'beat_competitor',
          beatByPercent: 1,
          respectMarginFloor: true,
          requireApproval: false,
        },
      }, {
        type: 'send_alert',
        config: {
          severity: 'medium',
          titleTemplate: 'Price adjusted for {{listing.asin}}',
          messageTemplate: 'Automatically matched competitor price. New price: £{{result.newPrice}}',
        },
      }],
      controls: {
        cooldownMinutes: 60,
        maxDailyTriggers: 5,
      },
    },
  },

  {
    id: 'competitor_out_of_stock',
    name: 'Capitalize on Competitor Stock-Out',
    description: 'Alert when competitor goes out of stock',
    category: 'competitive',
    defaultConfig: {
      trigger: {
        type: 'competitive',
        event: 'competitor_out_of_stock',
        competitorFilter: {
          threatScoreMin: 60,
        },
      },
      actions: [{
        type: 'send_alert',
        config: {
          severity: 'high',
          titleTemplate: 'Opportunity: Competitor out of stock!',
          messageTemplate: 'Competitor {{triggerData.competitorId}} is out of stock. Consider adjusting strategy for {{listing.asin}}.',
        },
      }, {
        type: 'create_task',
        config: {
          taskType: 'pricing',
          titleTemplate: 'Review pricing opportunity: {{listing.asin}}',
          priority: 'high',
          dueInDays: 1,
        },
      }],
    },
  },

  {
    id: 'buy_box_lost',
    name: 'Buy Box Lost Alert',
    description: 'Alert and create task when Buy Box is lost',
    category: 'competitive',
    defaultConfig: {
      trigger: {
        type: 'competitive',
        event: 'buy_box_lost',
      },
      conditions: [
        { field: 'listing.lifecycleStage', operator: 'in', value: ['growth', 'mature'] },
      ],
      actions: [{
        type: 'send_alert',
        config: {
          severity: 'high',
          titleTemplate: 'Buy Box lost: {{listing.asin}}',
          messageTemplate: 'Lost Buy Box to {{triggerData.wonBy}}. Their price: £{{triggerData.winningPrice}}',
        },
      }, {
        type: 'create_task',
        config: {
          taskType: 'pricing',
          titleTemplate: 'Recover Buy Box: {{listing.asin}}',
          priority: 'high',
          dueInDays: 1,
        },
      }],
    },
  },

  // === INVENTORY RULES ===
  {
    id: 'low_stock_alert',
    name: 'Low Stock Warning',
    description: 'Alert when stock drops below reorder point',
    category: 'inventory',
    defaultConfig: {
      trigger: {
        type: 'threshold',
        metric: 'stock',
        operator: 'lte',
        value: 10,
      },
      actions: [{
        type: 'send_alert',
        config: {
          severity: 'high',
          titleTemplate: 'Low stock: {{listing.sku}}',
          messageTemplate: 'Only {{triggerData.currentValue}} units remaining. Reorder recommended.',
        },
      }, {
        type: 'tag_listing',
        config: {
          addTags: ['low_stock'],
        },
      }],
    },
  },

  // === MARGIN RULES ===
  {
    id: 'margin_erosion_alert',
    name: 'Margin Erosion Warning',
    description: 'Alert when margin drops below threshold',
    category: 'pricing',
    defaultConfig: {
      trigger: {
        type: 'threshold',
        metric: 'margin',
        operator: 'lt',
        value: 15,
      },
      conditions: [
        { field: 'listing.status', operator: 'eq', value: 'active' },
      ],
      actions: [{
        type: 'send_alert',
        config: {
          severity: 'high',
          titleTemplate: 'Margin erosion: {{listing.asin}}',
          messageTemplate: 'Margin dropped to {{triggerData.currentValue}}%. Review pricing strategy.',
        },
      }, {
        type: 'create_task',
        config: {
          taskType: 'pricing',
          titleTemplate: 'Review margin: {{listing.asin}}',
          priority: 'high',
        },
      }],
    },
  },

  // === SEASONAL RULES ===
  {
    id: 'seasonal_preparation',
    name: 'Seasonal Preparation Reminder',
    description: 'Remind to prepare listings for peak season',
    category: 'seasonal',
    defaultConfig: {
      trigger: {
        type: 'time',
        schedule: '0 9 1 2,8 *', // Feb 1st and Aug 1st at 9am
      },
      scope: {
        type: 'tag',
        value: 'seasonal',
      },
      actions: [{
        type: 'create_task',
        config: {
          taskType: 'optimization',
          titleTemplate: 'Seasonal prep: {{listing.asin}}',
          descriptionTemplate: 'Review and optimize listing for upcoming peak season',
          priority: 'medium',
          dueInDays: 14,
        },
      }],
    },
  },
];
```

---

## 5. Rule Builder UI Integration

### 5.1 Rule Builder API

```typescript
// API endpoints for rule management

// GET /api/v1/automation/templates
// Returns available rule templates

// POST /api/v1/automation/rules
// Create a new rule
interface CreateRuleRequest {
  name: string;
  description?: string;
  templateId?: string;      // Start from template
  trigger: RuleTrigger;
  scope: RuleScope;
  conditions: RuleCondition[];
  actions: RuleAction[];
  controls: ExecutionControls;
}

// POST /api/v1/automation/rules/:id/test
// Test a rule against specific listings
interface TestRuleRequest {
  listingIds: string[];
}

interface TestRuleResponse {
  results: {
    listingId: string;
    wouldTrigger: boolean;
    conditionsMatched: boolean[];
    simulatedActions: {
      action: string;
      wouldExecute: boolean;
      simulatedResult: unknown;
    }[];
  }[];
}

// POST /api/v1/automation/rules/:id/execute
// Manually execute a rule
interface ExecuteRuleRequest {
  listingIds?: string[];    // Optional: specific listings
  dryRun?: boolean;         // Preview only
}
```

---

## 6. Execution Monitoring

### 6.1 Execution History Schema

```sql
CREATE TABLE automation.executions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id             UUID NOT NULL REFERENCES workflow.automation_rules(id),

    -- Timing
    started_at          TIMESTAMPTZ NOT NULL,
    completed_at        TIMESTAMPTZ,

    -- Status
    status              VARCHAR(20) NOT NULL, -- 'running', 'completed', 'failed', 'rolled_back'

    -- Trigger details
    trigger_type        VARCHAR(30) NOT NULL,
    trigger_data        JSONB,

    -- Results
    entities_evaluated  INTEGER,
    entities_matched    INTEGER,
    actions_executed    INTEGER,
    actions_failed      INTEGER,

    -- Error info
    error_message       TEXT,
    error_stack         TEXT,

    -- Metrics
    execution_time_ms   INTEGER,

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE automation.execution_actions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id        UUID NOT NULL REFERENCES automation.executions(id),

    -- Action details
    action_type         VARCHAR(30) NOT NULL,
    entity_id           UUID NOT NULL,

    -- Results
    success             BOOLEAN NOT NULL,
    result_data         JSONB,
    error_message       TEXT,

    -- Rollback
    rollback_data       JSONB,
    rolled_back_at      TIMESTAMPTZ,

    created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Next Document: Implementation Roadmap →
