import { Body, Container, Heading, Html, Text } from "@react-email/components";

export interface CrawlAlertEmailProps {
  companyName: string;
  ats: string;
  atsIdentifier: string;
  consecutiveFailures: number;
}

export function CrawlAlertEmail({ companyName, ats, atsIdentifier, consecutiveFailures }: CrawlAlertEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading style={{ fontSize: "18px" }}>Crawl failing: {companyName}</Heading>
          <Text>
            {companyName} ({ats}/{atsIdentifier}) has failed its last {consecutiveFailures} crawl runs in a row. Check
            the crawl health view in the app for error details.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
