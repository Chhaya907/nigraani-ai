CREATE TABLE `anomalies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`anomalyCode` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`moduleType` enum('DUPLICATE_WORK','FUND_MOVEMENT','DELAY_RISK','EVIDENCE_REUSE') NOT NULL,
	`severity` enum('Low','Medium','High','Critical') NOT NULL,
	`score` double NOT NULL,
	`flaggedText` text NOT NULL,
	`reasoning` text NOT NULL,
	`status` enum('FLAGGED','UNDER_REVIEW','CLARIFICATION_REQUESTED','EXPLAINED','ACTION_TAKEN','RESOLVED') NOT NULL DEFAULT 'FLAGGED',
	`detectionMetadata` json,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OPERATIONAL_UPDATE',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `anomalies_id` PRIMARY KEY(`id`),
	CONSTRAINT `anomalies_anomalyCode_unique` UNIQUE(`anomalyCode`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`auditCode` varchar(64) NOT NULL,
	`userId` int,
	`userName` varchar(128) NOT NULL,
	`userRole` enum('mospi','state','district','mp','cag') NOT NULL,
	`action` varchar(64) NOT NULL,
	`projectId` int,
	`projectCode` varchar(64),
	`targetId` varchar(64) NOT NULL,
	`targetType` varchar(64),
	`fieldChanged` varchar(128),
	`oldValue` text,
	`newValue` text,
	`comments` text,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OPERATIONAL_UPDATE',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_logs_auditCode_unique` UNIQUE(`auditCode`)
);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseNumber` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`priority` enum('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
	`status` enum('OPEN','PENDING_DISTRICT_RESPONSE','PENDING_STATE_REVIEW','ESCALATED_TO_MOSPI','AUDIT_OBSERVATION','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
	`assignedRole` enum('mospi','state','district','mp','cag') NOT NULL,
	`assignedDistrict` varchar(128),
	`assignedState` varchar(128),
	`openedBy` varchar(128) NOT NULL,
	`deadline` timestamp,
	`escalatedAt` timestamp,
	`resolvedAt` timestamp,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OPERATIONAL_UPDATE',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cases_id` PRIMARY KEY(`id`),
	CONSTRAINT `cases_caseNumber_unique` UNIQUE(`caseNumber`)
);
--> statement-breakpoint
CREATE TABLE `data_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(64) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`sourceUrl` text,
	`sourceOrganization` varchar(255) DEFAULT 'Ministry of Statistics and Programme Implementation (MoSPI)',
	`recordsCount` int NOT NULL DEFAULT 0,
	`status` enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'COMPLETED',
	`importedBy` varchar(128) NOT NULL,
	`summary` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_imports_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_imports_batchId_unique` UNIQUE(`batchId`)
);
--> statement-breakpoint
CREATE TABLE `data_provenance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` int NOT NULL,
	`importBatchId` varchar(64),
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL,
	`officialPortal` varchar(255),
	`publishedDate` timestamp,
	`ingestedAt` timestamp NOT NULL DEFAULT (now()),
	`verifiedByRole` varchar(64),
	`notes` text,
	CONSTRAINT `data_provenance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`evidenceCode` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`caseId` int,
	`title` varchar(255) NOT NULL,
	`category` varchar(64) NOT NULL,
	`filePath` text NOT NULL,
	`fileUrl` text,
	`fileSize` int,
	`mimeType` varchar(128),
	`perceptualHash` varchar(128),
	`uploadedBy` varchar(128) NOT NULL,
	`uploadedRole` enum('mospi','state','district','mp','cag') NOT NULL,
	`verified` boolean DEFAULT false,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OPERATIONAL_UPDATE',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `evidence_evidenceCode_unique` UNIQUE(`evidenceCode`)
);
--> statement-breakpoint
CREATE TABLE `expenditures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`voucherNo` varchar(128),
	`disbursementDate` timestamp NOT NULL DEFAULT (now()),
	`amount` double NOT NULL,
	`purpose` text,
	`recipientAgency` varchar(255),
	`utilizationCertificateStatus` varchar(64) DEFAULT 'Pending',
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OFFICIAL_PUBLIC',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expenditures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`updatedBy` varchar(128) NOT NULL,
	`role` enum('mospi','state','district','mp','cag') NOT NULL,
	`updateType` varchar(64) NOT NULL,
	`previousProgress` int,
	`newProgress` int,
	`remarks` text,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OPERATIONAL_UPDATE',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_updates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`state` varchar(128) NOT NULL,
	`district` varchar(128) NOT NULL,
	`constituency` varchar(128),
	`recommendedBy` varchar(128),
	`sanctionOrderNo` varchar(128),
	`implementingAgency` varchar(255),
	`category` varchar(128),
	`status` enum('Recommended','Sanctioned','Active','Delayed','Completed','Cancelled') NOT NULL DEFAULT 'Active',
	`progress` int NOT NULL DEFAULT 0,
	`sanctionedAmount` double NOT NULL DEFAULT 0,
	`spentAmount` double NOT NULL DEFAULT 0,
	`utilization` double NOT NULL DEFAULT 0,
	`riskScore` int NOT NULL DEFAULT 0,
	`riskLevel` enum('Low','Medium','High') NOT NULL DEFAULT 'Low',
	`startDate` timestamp,
	`targetCompletionDate` timestamp,
	`actualCompletionDate` timestamp,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OFFICIAL_PUBLIC',
	`provenanceId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_projectCode_unique` UNIQUE(`projectCode`)
);
--> statement-breakpoint
CREATE TABLE `risk_assessments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`compositeScore` int NOT NULL,
	`riskLevel` enum('Low','Medium','High') NOT NULL,
	`duplicateWorkScore` double DEFAULT 0,
	`fundMovementScore` double DEFAULT 0,
	`delayRiskScore` double DEFAULT 0,
	`evidenceReuseScore` double DEFAULT 0,
	`explainableFactors` json,
	`sourceType` enum('OFFICIAL_PUBLIC','OPERATIONAL_UPDATE','DEMO_AUGMENTATION') NOT NULL DEFAULT 'OPERATIONAL_UPDATE',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `risk_assessments_id` PRIMARY KEY(`id`)
);
