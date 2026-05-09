import { initGatewayController } from "./ui/controller.js";
import { initMobileGatewayClient, shouldUseMobileGatewayClient } from "./mobile/client.js";

if (shouldUseMobileGatewayClient()) {
  initMobileGatewayClient();
} else {
  initGatewayController();
}
