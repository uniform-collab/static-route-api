#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { StaticRouteApiStack } from "../lib/static-route-api-stack";

new StaticRouteApiStack(new App(), "StaticRouteApiStack");
